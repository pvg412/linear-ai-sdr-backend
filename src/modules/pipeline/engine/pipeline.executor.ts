import { inject, injectable } from "inversify";
import type { Redis } from "ioredis";
import type { Prisma } from "@prisma/client";

import { QUEUE_TYPES } from "@/infra/queue/queue.types";
import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { PIPELINE_TYPES } from "@/modules/pipeline/pipeline.types";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import type { PipelineStepRegistry } from "@/modules/pipeline/engine/pipeline.registry";
import type { PipelineBroadcaster } from "@/modules/pipeline/engine/pipeline.broadcaster";
import {
  applyContextPatch,
  hydrateContext,
} from "@/modules/pipeline/engine/pipeline.context";
import {
  buildProgress,
  type PipelineContext,
  type PipelineStepConfig,
  type PipelineDefinition,
  type PipelineTools,
  type OnErrorPolicy,
  type RetryPolicy,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const CANCEL_KEY_PREFIX = "pipeline:cancel:";
const CANCEL_KEY_TTL_SECONDS = 3600; // 1 hour

const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  backoffMs: 2000,
  backoffType: "exponential",
};

/* ------------------------------------------------------------------ */
/*  Executor                                                          */
/* ------------------------------------------------------------------ */

@injectable()
export class PipelineExecutor {
  constructor(
    @inject(PIPELINE_TYPES.PipelineRepository)
    private readonly repo: PipelineRepository,
    @inject(PIPELINE_TYPES.PipelineStepRegistry)
    private readonly registry: PipelineStepRegistry,
    @inject(PIPELINE_TYPES.PipelineBroadcaster)
    private readonly broadcaster: PipelineBroadcaster,
    @inject(QUEUE_TYPES.Redis)
    private readonly redis: Redis,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Main entry point (called from BullMQ worker)                    */
  /* ---------------------------------------------------------------- */

  async executePipeline(
    pipelineRunId: string,
    log?: LoggerLike,
  ): Promise<void> {
    const lg = ensureLogger(log);

    /* 1. Load the run ------------------------------------------------ */
    const run = await this.repo.getRunById(pipelineRunId);
    if (!run) {
      lg.error({ pipelineRunId }, "Pipeline run not found; aborting");
      return;
    }

    if (run.status !== "PENDING" && run.status !== "RUNNING") {
      lg.warn(
        { pipelineRunId, status: run.status },
        "Pipeline run is not in an executable state; skipping",
      );
      return;
    }

    const definition = run.definition as unknown as PipelineDefinition;
    const steps = definition.steps;
    const enabledSteps = steps.filter((s) => s.enabled !== false);
    const totalSteps = enabledSteps.length;

    /* 2. Mark run as RUNNING ---------------------------------------- */
    await this.repo.updateRunStatus(pipelineRunId, "RUNNING", {
      startedAt: new Date(),
    });

    this.broadcaster.emitRunStarted(
      pipelineRunId,
      definition.key,
      enabledSteps.map((s) => ({
        stepId: s.id,
        displayName: s.displayName,
        stepType: s.type,
      })),
    );

    lg.info(
      { pipelineRunId, pipelineKey: definition.key, totalSteps },
      "Pipeline execution started",
    );

    /* 3. Hydrate context from DB ------------------------------------ */
    let ctx: PipelineContext = hydrateContext({
      pipelineRunId,
      pipelineKey: definition.key,
      createdById: run.createdById,
      companyId: run.companyId,
      input: run.input,
      data: run.context ?? {},
    });

    let completedSteps = 0;
    let lastFailedStepId: string | undefined;

    /* 4. Iterate steps sequentially --------------------------------- */
    for (let i = 0; i < steps.length; i++) {
      const stepConfig = steps[i];

      /* 4a. Check cancellation -------------------------------------- */
      if (await this.isCancelled(pipelineRunId)) {
        lg.info({ pipelineRunId, stepId: stepConfig.id }, "Pipeline cancelled");
        await this.repo.cancelRemainingSteps(pipelineRunId, i);
        await this.repo.updateRunStatus(pipelineRunId, "CANCELLED", {
          finishedAt: new Date(),
        });
        this.broadcaster.emitRunCancelled(
          pipelineRunId,
          buildProgress(completedSteps, totalSteps),
          stepConfig.id,
        );
        return;
      }

      /* 4b. Check if step is disabled ------------------------------- */
      /*    Disabled steps are completely transparent: no DB status   */
      /*    update, no WS events, not counted in progress.           */
      if (stepConfig.enabled === false) {
        lg.info({ pipelineRunId, stepId: stepConfig.id }, "Step disabled; skipping silently");
        continue;
      }

      /* 4c. Resolve handler ----------------------------------------- */
      const handler = this.registry.get(stepConfig.type);

      /* 4d. Update current step tracking ---------------------------- */
      await this.repo.updateRunCurrentStep(pipelineRunId, stepConfig.id, i);

      /* 4e. Execute the step with retry ----------------------------- */
      const retryPolicy = stepConfig.retryPolicy
        ?? definition.defaults?.retryPolicy
        ?? DEFAULT_RETRY_POLICY;
      const timeoutMs = stepConfig.timeoutMs
        ?? definition.defaults?.timeoutMs
        ?? DEFAULT_STEP_TIMEOUT_MS;
      const onError: OnErrorPolicy = stepConfig.onError
        ?? definition.defaults?.onError
        ?? "stop";

      const success = await this.executeStep({
        pipelineRunId,
        stepConfig,
        handler,
        ctx,
        retryPolicy,
        timeoutMs,
        completedSteps,
        totalSteps,
        lg,
      });

      if (success) {
        /* Re-read context from the DB after step (the step runner persists it) */
        const updatedRun = await this.repo.getRunById(pipelineRunId);
        if (updatedRun?.context) {
          ctx = hydrateContext({
            pipelineRunId,
            pipelineKey: definition.key,
            createdById: run.createdById,
            companyId: run.companyId,
            input: run.input,
            data: updatedRun.context,
          });
        }
        completedSteps++;
      } else {
        lastFailedStepId = stepConfig.id;

        if (onError === "stop") {
          lg.error(
            { pipelineRunId, stepId: stepConfig.id },
            "Step failed with onError=stop; aborting pipeline",
          );
          await this.repo.cancelRemainingSteps(pipelineRunId, i + 1);
          await this.repo.updateRunStatus(pipelineRunId, "FAILED", {
            finishedAt: new Date(),
            errorMessage: `Step "${stepConfig.displayName}" failed`,
            errorStepId: stepConfig.id,
          });
          this.broadcaster.emitRunFailed(
            pipelineRunId,
            `Step "${stepConfig.displayName}" failed`,
            buildProgress(completedSteps, totalSteps),
            stepConfig.id,
          );
          return;
        }

        /* onError === "continue" → skip and proceed */
        lg.warn(
          { pipelineRunId, stepId: stepConfig.id },
          "Step failed with onError=continue; proceeding",
        );
        completedSteps++;
      }
    }

    /* 5. Pipeline completed ----------------------------------------- */
    await this.repo.updateRunStatus(pipelineRunId, "SUCCEEDED", {
      finishedAt: new Date(),
    });

    this.broadcaster.emitRunSucceeded(
      pipelineRunId,
      {
        stepsCompleted: completedSteps,
        totalSteps,
        failedStepId: lastFailedStepId,
      },
      buildProgress(completedSteps, totalSteps),
    );

    lg.info(
      { pipelineRunId, completedSteps, totalSteps },
      "Pipeline execution succeeded",
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Step execution with retry + timeout                             */
  /* ---------------------------------------------------------------- */

  private async executeStep(args: {
    pipelineRunId: string;
    stepConfig: PipelineStepConfig;
    handler: ReturnType<PipelineStepRegistry["get"]>;
    ctx: PipelineContext;
    retryPolicy: RetryPolicy;
    timeoutMs: number;
    completedSteps: number;
    totalSteps: number;
    lg: LoggerLike;
  }): Promise<boolean> {
    const {
      pipelineRunId,
      stepConfig,
      handler,
      ctx: stepCtx,
      retryPolicy,
      timeoutMs,
      completedSteps,
      totalSteps,
      lg,
    } = args;

    const maxAttempts = Math.max(1, retryPolicy.maxAttempts);
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      /* Check cancellation before each attempt */
      if (await this.isCancelled(pipelineRunId)) {
        return false;
      }

      const startedAt = new Date();

      /* Mark step as RUNNING */
      await this.repo.updateStepStatus(pipelineRunId, stepConfig.id, "RUNNING", {
        startedAt,
        attempts: attempt,
      });

      if (attempt === 1) {
        this.broadcaster.emitStepStarted(
          pipelineRunId,
          stepConfig.id,
          stepConfig.type,
          stepConfig.displayName,
          buildProgress(completedSteps, totalSteps),
        );
      }

      /* Build tools for this step */
      const tools: PipelineTools = {
        log: lg,
        checkCancelled: () => this.isCancelled(pipelineRunId),
        emitProgress: (message: string, data?: unknown) => {
          this.broadcaster.emitStepProgress(
            pipelineRunId,
            stepConfig.id,
            message,
            data,
          );
        },
      };

      try {
        /* Execute with timeout */
        const result = await this.withTimeout(
          handler.run(stepCtx, stepConfig.config ?? {}, tools),
          timeoutMs,
          stepConfig.id,
        );

        /* Success: patch context and persist */
        const newData = applyContextPatch(stepCtx.data, result.contextPatch);

        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        await this.repo.updateStepStatus(
          pipelineRunId,
          stepConfig.id,
          "SUCCEEDED",
          {
            finishedAt,
            durationMs,
            outputSummary: JSON.parse(JSON.stringify(result.outputSummary)) as Prisma.InputJsonValue,
          },
        );

        /* Persist the updated context on the run */
        await this.repo.updateRunContext(
          pipelineRunId,
          JSON.parse(JSON.stringify(newData)) as Prisma.InputJsonValue,
        );

        this.broadcaster.emitStepSucceeded(
          pipelineRunId,
          stepConfig.id,
          result.outputSummary,
          buildProgress(completedSteps + 1, totalSteps),
          durationMs,
        );

        lg.info(
          { pipelineRunId, stepId: stepConfig.id, attempt, durationMs },
          "Step succeeded",
        );

        return true;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        lg.warn(
          {
            pipelineRunId,
            stepId: stepConfig.id,
            attempt,
            maxAttempts,
            err: lastError.message,
          },
          "Step attempt failed",
        );

        if (attempt < maxAttempts) {
          /* Backoff before next attempt */
          const delay =
            retryPolicy.backoffType === "exponential"
              ? retryPolicy.backoffMs * Math.pow(2, attempt - 1)
              : retryPolicy.backoffMs;
          await sleep(delay);
        }
      }
    }

    /* All attempts exhausted — mark step as failed */
    const errorMessage = lastError?.message ?? "Unknown error";

    await this.repo.updateStepStatus(pipelineRunId, stepConfig.id, "FAILED", {
      finishedAt: new Date(),
      errorMessage,
    });

    this.broadcaster.emitStepFailed(
      pipelineRunId,
      stepConfig.id,
      errorMessage,
      buildProgress(completedSteps, totalSteps),
    );

    lg.error(
      { pipelineRunId, stepId: stepConfig.id, error: errorMessage },
      "Step failed after all attempts",
    );

    return false;
  }

  /* ---------------------------------------------------------------- */
  /*  Cancellation                                                    */
  /* ---------------------------------------------------------------- */

  async isCancelled(pipelineRunId: string): Promise<boolean> {
    try {
      const val = await this.redis.get(
        `${CANCEL_KEY_PREFIX}${pipelineRunId}`,
      );
      return val === "1";
    } catch {
      return false;
    }
  }

  async markCancelled(pipelineRunId: string): Promise<void> {
    await this.redis.set(
      `${CANCEL_KEY_PREFIX}${pipelineRunId}`,
      "1",
      "EX",
      CANCEL_KEY_TTL_SECONDS,
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Timeout helper                                                  */
  /* ---------------------------------------------------------------- */

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    stepId: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step "${stepId}" timed out after ${ms}ms`));
      }, ms);

      promise
        .then((val) => {
          clearTimeout(timer);
          resolve(val);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
