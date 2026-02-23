import { inject, injectable } from "inversify";
import type { Queue } from "bullmq";
import { MessageSender, type Prisma } from "@prisma/client";

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
import { buildProgress } from "@/modules/pipeline/schemas/pipeline.dto";
import {
  pipelineRunJobOptions,
  type PipelineRunJobData,
  type PipelineRunJobName,
} from "@/infra/queue/pipeline-run/pipeline-run.queue";
import { getPrisma } from "@/infra/prisma";
import { LEAD_CONVERSATIONS_TYPES } from "@/modules/lead-conversations/lead-conversations.types";
import type { LeadConversationsRepository } from "@/modules/lead-conversations/persistence/lead-conversations.repository";

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
    @inject(LEAD_CONVERSATIONS_TYPES.LeadConversationsRepository)
    private readonly conversationsRepo: LeadConversationsRepository,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Start Pipeline                                                  */
  /* ---------------------------------------------------------------- */

  async startPipeline(
    userId: string,
    pipelineKey: string,
    input: { leadIds?: string[]; directoryId?: string },
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

    /* 4. Ensure company has at least one service catalog */
    const catalogCount = await this.prisma.companyServiceCatalog.count({
      where: { companyId },
    });
    if (catalogCount === 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage:
          "Cannot start pipeline: no service catalogs configured for the company. Please add at least one service catalog before running a pipeline.",
      });
    }

    /* 5. Check global concurrency limit */
    const globalRunning = await this.repo.countRunningGlobal();
    const maxGlobal = env.PIPELINE_MAX_CONCURRENT_GLOBAL;
    if (globalRunning >= maxGlobal) {
      throw new UserFacingError({
        code: "TOO_MANY_REQUESTS",
        userMessage:
          "The system is currently busy processing another pipeline. Please try again later.",
      });
    }

    /* 6. Check concurrency limit per company */
    const runningCount = await this.repo.countRunningForCompany(companyId);
    const maxConcurrent = env.PIPELINE_MAX_CONCURRENT_PER_COMPANY;
    if (runningCount >= maxConcurrent) {
      throw new UserFacingError({
        code: "TOO_MANY_REQUESTS",
        userMessage: `Too many concurrent pipeline runs (${runningCount}/${maxConcurrent}). Please wait for an existing run to finish.`,
      });
    }

    /* 7. Create PipelineRun + PipelineStepRun records */
    const defaults = definition.defaults;
    const run = await this.repo.createRun({
      pipelineKey: definition.key,
      pipelineVersion: definition.version,
      createdById: userId,
      companyId,
      pipelineDisplayName: definition.displayName,
      pipelineDescription: definition.description,
      defaultOnError: defaults?.onError,
      defaultTimeoutMs: defaults?.timeoutMs,
      defaultRetryMaxAttempts: defaults?.retryPolicy?.maxAttempts,
      defaultRetryBackoffMs: defaults?.retryPolicy?.backoffMs,
      defaultRetryBackoffType: defaults?.retryPolicy?.backoffType,
      inputDirectoryId: input.directoryId,
      inputLeadIds: input.leadIds,
      steps: definition.steps.map((s, i) => ({
        stepId: s.id,
        stepType: s.type,
        stepIndex: i,
        displayName: s.displayName,
        stepConfig: s.config
          ? (JSON.parse(JSON.stringify(s.config)) as Prisma.InputJsonValue)
          : undefined,
        onError: s.onError,
        timeoutMs: s.timeoutMs,
        retryMaxAttempts: s.retryPolicy?.maxAttempts,
        retryBackoffMs: s.retryPolicy?.backoffMs,
        retryBackoffType: s.retryPolicy?.backoffType,
        enabled: s.enabled,
      })),
    });

    /* 8. Enqueue BullMQ job */
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

  /* ---------------------------------------------------------------- */
  /*  Accept Outreach Draft                                           */
  /* ---------------------------------------------------------------- */

  async acceptOutreachDraft(
    userId: string,
    pipelineRunId: string,
    messageId: string,
  ) {
    /* 1. Ownership check */
    await this.repo.getRunForUser(userId, pipelineRunId);

    /* 2. Verify message belongs to this run */
    const link = await this.repo.findOutreachLink(pipelineRunId, messageId);
    if (!link) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Outreach message not found in this pipeline run.",
      });
    }

    const draft = link.message;

    /* 3. One accepted message per lead per run */
    const alreadyAccepted = await this.repo.hasAcceptedMessageForLead(
      pipelineRunId,
      draft.leadId,
    );
    if (alreadyAccepted) {
      throw new UserFacingError({
        code: "CONFLICT",
        userMessage:
          "A message has already been saved for this lead in this pipeline run.",
      });
    }

    /* 4. Create finalized message (copy from draft, set sentAt) */
    const finalMsg = await this.conversationsRepo.createMessage({
      leadId: draft.leadId,
      channel: draft.channel,
      stage: draft.stage ?? undefined,
      subject: draft.subject ?? undefined,
      body: draft.body,
      characterCount: draft.characterCount ?? undefined,
      wordCount: draft.wordCount ?? undefined,
      usageNote: draft.usageNote ?? undefined,
      tacticUsed: draft.tacticUsed ?? undefined,
      createdBy: userId,
      senderType: MessageSender.SALE_MANAGER,
      sentAt: new Date(),
    });

    /* 5. Link the finalized message to the pipeline run */
    await this.conversationsRepo.linkToPipelineRun(
      finalMsg.id,
      pipelineRunId,
    );

    return finalMsg;
  }

  /* ---------------------------------------------------------------- */
  /*  Save Custom (edited) Outreach                                   */
  /* ---------------------------------------------------------------- */

  async saveCustomOutreach(
    userId: string,
    pipelineRunId: string,
    messageId: string,
    body: string,
    subject?: string,
  ) {
    /* 1. Ownership check */
    await this.repo.getRunForUser(userId, pipelineRunId);

    /* 2. Verify message belongs to this run */
    const link = await this.repo.findOutreachLink(pipelineRunId, messageId);
    if (!link) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Outreach message not found in this pipeline run.",
      });
    }

    const draft = link.message;

    /* 3. One accepted message per lead per run */
    const alreadyAccepted = await this.repo.hasAcceptedMessageForLead(
      pipelineRunId,
      draft.leadId,
    );
    if (alreadyAccepted) {
      throw new UserFacingError({
        code: "CONFLICT",
        userMessage:
          "A message has already been saved for this lead in this pipeline run.",
      });
    }

    /* 4. Create finalized message with edited content */
    const finalMsg = await this.conversationsRepo.createMessage({
      leadId: draft.leadId,
      channel: draft.channel,
      stage: draft.stage ?? undefined,
      subject: subject ?? draft.subject ?? undefined,
      body,
      characterCount: body.length,
      wordCount: body.split(/\s+/).filter(Boolean).length,
      usageNote: draft.usageNote ?? undefined,
      tacticUsed: draft.tacticUsed ?? undefined,
      createdBy: userId,
      senderType: MessageSender.SALE_MANAGER,
      sentAt: new Date(),
    });

    /* 5. Link the finalized message to the pipeline run */
    await this.conversationsRepo.linkToPipelineRun(
      finalMsg.id,
      pipelineRunId,
    );

    return finalMsg;
  }

  /* ---------------------------------------------------------------- */
  /*  Delete Outreach Draft                                           */
  /* ---------------------------------------------------------------- */

  async deleteOutreachDraft(
    userId: string,
    pipelineRunId: string,
    messageId: string,
  ): Promise<void> {
    /* 1. Ownership check */
    await this.repo.getRunForUser(userId, pipelineRunId);

    /* 2. Verify message belongs to this run */
    const link = await this.repo.findOutreachLink(pipelineRunId, messageId);
    if (!link) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Outreach message not found in this pipeline run.",
      });
    }

    /* 3. Only drafts (sentAt = null) can be deleted */
    if (link.message.sentAt !== null) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "Cannot delete an already accepted message.",
      });
    }

    /* 4. Delete message (junction row cascades) */
    await this.repo.deleteOutreachMessage(messageId);
  }
}
