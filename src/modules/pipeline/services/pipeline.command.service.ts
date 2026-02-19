import { inject, injectable } from "inversify";
import type { Queue } from "bullmq";
import type { Prisma } from "@prisma/client";

import { UserFacingError } from "@/infra/userFacingError";
import { loadEnv } from "@/config/env";
import { QUEUE_TYPES } from "@/infra/queue/queue.types";
import { PIPELINE_TYPES } from "@/modules/pipeline/pipeline.types";
import type { PipelineRepository } from "@/modules/pipeline/persistence/pipeline.repository";
import type { PipelineExecutor } from "@/modules/pipeline/engine/pipeline.executor";
import type { PipelineBroadcaster } from "@/modules/pipeline/engine/pipeline.broadcaster";
import type { PipelineStepRegistry } from "@/modules/pipeline/engine/pipeline.registry";
import {
  getPipelineDefinition,
} from "@/modules/pipeline/engine/pipeline.definitions";
import type { PipelineInput } from "@/modules/pipeline/schemas/pipeline.dto";
import { buildProgress } from "@/modules/pipeline/schemas/pipeline.dto";
import {
  pipelineRunJobOptions,
  type PipelineRunJobData,
  type PipelineRunJobName,
} from "@/infra/queue/pipeline-run/pipeline-run.queue";
import { getPrisma } from "@/infra/prisma";

const env = loadEnv();

@injectable()
export class PipelineCommandService {
  private readonly prisma = getPrisma();

  constructor(
    @inject(PIPELINE_TYPES.PipelineRepository)
    private readonly repo: PipelineRepository,
    @inject(PIPELINE_TYPES.PipelineExecutor)
    private readonly executor: PipelineExecutor,
    @inject(PIPELINE_TYPES.PipelineBroadcaster)
    private readonly broadcaster: PipelineBroadcaster,
    @inject(PIPELINE_TYPES.PipelineStepRegistry)
    private readonly registry: PipelineStepRegistry,
    @inject(QUEUE_TYPES.PipelineRunQueue)
    private readonly queue: Queue<PipelineRunJobData, void, PipelineRunJobName>,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Start Pipeline                                                  */
  /* ---------------------------------------------------------------- */

  async startPipeline(
    userId: string,
    pipelineKey: string,
    input: PipelineInput,
  ): Promise<{ pipelineRunId: string }> {
    /* 1. Resolve definition */
    const definition = getPipelineDefinition(pipelineKey);
    if (!definition) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: `Unknown pipeline: "${pipelineKey}"`,
      });
    }

    /* 2. Validate all step types exist in registry */
    for (const step of definition.steps) {
      if (!this.registry.has(step.type)) {
        throw new UserFacingError({
          code: "BAD_REQUEST",
          userMessage: `Pipeline step type "${step.type}" is not registered`,
          debugMessage: `Step "${step.id}" references unknown handler type "${step.type}"`,
        });
      }
    }

    /* 3. Resolve company context */
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true },
    });
    if (!user) {
      throw new UserFacingError({
        code: "UNAUTHORIZED",
        userMessage: "User not found.",
      });
    }
    const companyId = user.companyId ?? user.id;

    /* 4. Check concurrency limit per company */
    const runningCount = await this.repo.countRunningForCompany(companyId);
    const maxConcurrent = env.PIPELINE_MAX_CONCURRENT_PER_COMPANY;
    if (runningCount >= maxConcurrent) {
      throw new UserFacingError({
        code: "TOO_MANY_REQUESTS",
        userMessage: `Too many concurrent pipeline runs (${runningCount}/${maxConcurrent}). Please wait for an existing run to finish.`,
      });
    }

    /* 5. Create PipelineRun + PipelineStepRun records */
    const run = await this.repo.createRun({
      pipelineKey: definition.key,
      pipelineVersion: definition.version,
      createdById: userId,
      companyId,
      input: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
      definition: JSON.parse(JSON.stringify(definition)) as Prisma.InputJsonValue,
      steps: definition.steps.map((s, i) => ({
        stepId: s.id,
        stepType: s.type,
        stepIndex: i,
        displayName: s.displayName,
      })),
    });

    /* 6. Enqueue BullMQ job */
    await this.queue.add(
      "pipeline.execute",
      { pipelineRunId: run.id },
      {
        jobId: run.id,
        ...pipelineRunJobOptions(),
      },
    );

    return { pipelineRunId: run.id };
  }

  /* ---------------------------------------------------------------- */
  /*  Cancel Pipeline                                                 */
  /* ---------------------------------------------------------------- */

  async cancelPipeline(
    userId: string,
    pipelineRunId: string,
  ): Promise<void> {
    /* 1. Load and verify ownership */
    const run = await this.repo.getRunForUser(userId, pipelineRunId);

    /* 2. Only PENDING or RUNNING runs can be cancelled */
    if (run.status !== "PENDING" && run.status !== "RUNNING") {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: `Cannot cancel a pipeline run with status "${run.status}".`,
      });
    }

    /* 3. Set Redis cancel flag */
    await this.executor.markCancelled(pipelineRunId);

    /* 4. Update DB */
    await this.repo.updateRunStatus(pipelineRunId, "CANCELLED", {
      finishedAt: new Date(),
    });

    /* Cancel remaining QUEUED steps */
    await this.repo.cancelRemainingSteps(pipelineRunId, 0);

    /* 5. Broadcast cancellation */
    const totalSteps = run.stepRuns.length;
    const completedSteps = run.stepRuns.filter(
      (s: { status: string }) => s.status === "SUCCEEDED" || s.status === "SKIPPED",
    ).length;

    this.broadcaster.emitRunCancelled(
      pipelineRunId,
      buildProgress(completedSteps, totalSteps),
      run.currentStepId ?? undefined,
    );
  }
}
