import { inject, injectable } from "inversify";
import type { Redis } from "ioredis";
import type { Prisma } from "@prisma/client";

import { QUEUE_TYPES } from "@/infra/queue/queue.types";
import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { UserFacingError } from "@/infra/userFacingError";
import { PIPELINE_TYPES } from "@/modules/pipeline/pipeline.types";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import type { PipelineStepRegistry } from "@/modules/pipeline/engine/pipeline.registry";
import type { PipelineBroadcaster } from "@/modules/pipeline/engine/pipeline.broadcaster";
import {
  buildProgress,
  type PipelineContext,
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
/*  Step-run shape (from DB include)                                  */
/* ------------------------------------------------------------------ */

interface StepRunRow {
  stepId: string;
  stepType: string;
  stepIndex: number;
  displayName: string;
  enabled: boolean;
  stepConfig: Prisma.JsonValue;
  onError: string | null;
  timeoutMs: number | null;
  retryMaxAttempts: number | null;
  retryBackoffMs: number | null;
  retryBackoffType: string | null;
}

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

    /* Step execution params come from PipelineStepRun rows */
    const stepRows = run.stepRuns as StepRunRow[];
    const enabledSteps = stepRows.filter((s) => s.enabled);
    const totalSteps = enabledSteps.length;

    /* Resolve default policies from the run's flat columns */
    const defaultOnError = (run.defaultOnError as OnErrorPolicy) ?? "stop";
    const defaultTimeoutMs = run.defaultTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const defaultRetryPolicy: RetryPolicy = {
      maxAttempts: run.defaultRetryMaxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
      backoffMs: run.defaultRetryBackoffMs ?? DEFAULT_RETRY_POLICY.backoffMs,
      backoffType: (run.defaultRetryBackoffType as RetryPolicy["backoffType"])
        ?? DEFAULT_RETRY_POLICY.backoffType,
    };

    /* 2. Mark run as RUNNING ---------------------------------------- */
    await this.repo.updateRunStatus(pipelineRunId, "RUNNING", {
      startedAt: new Date(),
    });

    this.broadcaster.emitRunStarted(
      pipelineRunId,
      run.pipelineKey,
      enabledSteps.map((s) => ({
        stepId: s.stepId,
        displayName: s.displayName,
        stepType: s.stepType,
      })),
    );

    lg.info(
      { pipelineRunId, pipelineKey: run.pipelineKey, totalSteps },
      "Pipeline execution started",
    );

    /* 3. Build immutable pipeline context --------------------------- */
    const ctx: PipelineContext = {
      pipelineRunId,
      pipelineKey: run.pipelineKey,
      createdById: run.createdById,
      companyId: run.companyId,
    };

    let completedSteps = 0;
    let lastFailedStepId: string | undefined;

    /* 4. Iterate steps sequentially --------------------------------- */
    for (let i = 0; i < stepRows.length; i++) {
      const stepRow = stepRows[i];

      /* 4a. Check cancellation -------------------------------------- */
      if (await this.isCancelled(pipelineRunId)) {
        lg.info({ pipelineRunId, stepId: stepRow.stepId }, "Pipeline cancelled");
        await this.repo.cancelRemainingSteps(pipelineRunId, i);
        await this.repo.updateRunStatus(pipelineRunId, "CANCELLED", {
          finishedAt: new Date(),
        });
        this.broadcaster.emitRunCancelled(
          pipelineRunId,
          buildProgress(completedSteps, totalSteps),
          stepRow.stepId,
        );
        return;
      }

      /* 4b. Check if step is disabled ------------------------------- */
      if (!stepRow.enabled) {
        lg.info({ pipelineRunId, stepId: stepRow.stepId }, "Step disabled; skipping silently");
        continue;
      }

      /* 4c. Resolve handler ----------------------------------------- */
      const handler = this.registry.get(stepRow.stepType);

      /* 4d. Update current step tracking ---------------------------- */
      await this.repo.updateRunCurrentStep(pipelineRunId, stepRow.stepId, i);

      /* 4e. Resolve execution params from step row or defaults ------ */
      const retryPolicy: RetryPolicy = {
        maxAttempts: stepRow.retryMaxAttempts ?? defaultRetryPolicy.maxAttempts,
        backoffMs: stepRow.retryBackoffMs ?? defaultRetryPolicy.backoffMs,
        backoffType: (stepRow.retryBackoffType as RetryPolicy["backoffType"])
          ?? defaultRetryPolicy.backoffType,
      };
      const timeoutMs = stepRow.timeoutMs ?? defaultTimeoutMs;
      const onError: OnErrorPolicy = (stepRow.onError as OnErrorPolicy) ?? defaultOnError;

      const stepConfig = (stepRow.stepConfig as Record<string, unknown>) ?? {};

      const success = await this.executeStep({
        pipelineRunId,
        stepId: stepRow.stepId,
        stepType: stepRow.stepType,
        displayName: stepRow.displayName,
        handler,
        ctx,
        stepConfig,
        retryPolicy,
        timeoutMs,
        completedSteps,
        totalSteps,
        lg,
      });

      if (success) {
        completedSteps++;
      } else {
        lastFailedStepId = stepRow.stepId;

        if (onError === "stop") {
          lg.error(
            { pipelineRunId, stepId: stepRow.stepId },
            "Step failed with onError=stop; aborting pipeline",
          );
          await this.repo.cancelRemainingSteps(pipelineRunId, i + 1);
          await this.repo.updateRunStatus(pipelineRunId, "FAILED", {
            finishedAt: new Date(),
            errorMessage: `Step "${stepRow.displayName}" failed`,
            errorStepId: stepRow.stepId,
          });
          this.broadcaster.emitRunFailed(
            pipelineRunId,
            `Step "${stepRow.displayName}" failed`,
            buildProgress(completedSteps, totalSteps),
            stepRow.stepId,
          );
          return;
        }

        /* onError === "continue" → skip and proceed */
        lg.warn(
          { pipelineRunId, stepId: stepRow.stepId },
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
    stepId: string;
    stepType: string;
    displayName: string;
    handler: ReturnType<PipelineStepRegistry["get"]>;
    ctx: PipelineContext;
    stepConfig: Record<string, unknown>;
    retryPolicy: RetryPolicy;
    timeoutMs: number;
    completedSteps: number;
    totalSteps: number;
    lg: LoggerLike;
  }): Promise<boolean> {
    const {
      pipelineRunId,
      stepId,
      stepType,
      displayName,
      handler,
      ctx: stepCtx,
      stepConfig,
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
      await this.repo.updateStepStatus(pipelineRunId, stepId, "RUNNING", {
        startedAt,
        attempts: attempt,
      });

      if (attempt === 1) {
        this.broadcaster.emitStepStarted(
          pipelineRunId,
          stepId,
          stepType,
          displayName,
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
            stepId,
            message,
            data,
          );
        },
      };

      try {
        /* Execute with timeout */
        const result = await this.withTimeout(
          handler.run(stepCtx, stepConfig, tools),
          timeoutMs,
          stepId,
        );

        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        await this.repo.updateStepStatus(
          pipelineRunId,
          stepId,
          "SUCCEEDED",
          {
            finishedAt,
            durationMs,
            outputSummary: JSON.parse(JSON.stringify(result.outputSummary)) as Prisma.InputJsonValue,
          },
        );

        this.broadcaster.emitStepSucceeded(
          pipelineRunId,
          stepId,
          result.outputSummary,
          result.data,
          buildProgress(completedSteps + 1, totalSteps),
          durationMs,
        );

        lg.info(
          { pipelineRunId, stepId, attempt, durationMs },
          "Step succeeded",
        );

        return true;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        lg.warn(
          {
            pipelineRunId,
            stepId,
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
    const rawError = lastError?.message ?? "Unknown error";
    const errorMessage =
      lastError instanceof UserFacingError
        ? lastError.userMessage
        : "An unexpected error occurred. Please try again.";

    await this.repo.updateStepStatus(pipelineRunId, stepId, "FAILED", {
      finishedAt: new Date(),
      errorMessage,
    });

    this.broadcaster.emitStepFailed(
      pipelineRunId,
      stepId,
      errorMessage,
      buildProgress(completedSteps, totalSteps),
    );

    lg.error(
      { pipelineRunId, stepId, error: rawError },
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
