import { injectable } from "inversify";
import { Prisma, type PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type PipelineRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type PipelineStepRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "CANCELLED";

export interface CreatePipelineRunInput {
  pipelineKey: string;
  pipelineVersion: number;
  createdById: string;
  companyId: string | null;
  pipelineDisplayName: string;
  pipelineDescription?: string;
  defaultOnError?: string;
  defaultTimeoutMs?: number;
  defaultRetryMaxAttempts?: number;
  defaultRetryBackoffMs?: number;
  defaultRetryBackoffType?: string;
  inputDirectoryId?: string;
  inputLeadIds?: string[];
  steps: Array<{
    stepId: string;
    stepType: string;
    stepIndex: number;
    displayName: string;
    stepConfig?: Prisma.InputJsonValue;
    onError?: string;
    timeoutMs?: number;
    retryMaxAttempts?: number;
    retryBackoffMs?: number;
    retryBackoffType?: string;
    enabled?: boolean;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Repository                                                        */
/* ------------------------------------------------------------------ */

@injectable()
export class PipelineRepository {
  private readonly prisma: PrismaClient = getPrisma();

  /* ---------------------------------------------------------------- */
  /*  Create                                                          */
  /* ---------------------------------------------------------------- */

  async createRun(input: CreatePipelineRunInput) {
    return this.prisma.pipelineRun.create({
      data: {
        pipelineKey: input.pipelineKey,
        pipelineVersion: input.pipelineVersion,
        createdById: input.createdById,
        companyId: input.companyId,
        pipelineDisplayName: input.pipelineDisplayName,
        pipelineDescription: input.pipelineDescription,
        defaultOnError: input.defaultOnError,
        defaultTimeoutMs: input.defaultTimeoutMs,
        defaultRetryMaxAttempts: input.defaultRetryMaxAttempts,
        defaultRetryBackoffMs: input.defaultRetryBackoffMs,
        defaultRetryBackoffType: input.defaultRetryBackoffType,
        inputDirectoryId: input.inputDirectoryId,
        inputLeadIds: input.inputLeadIds ?? [],
        stepRuns: {
          createMany: {
            data: input.steps.map((s) => ({
              stepId: s.stepId,
              stepType: s.stepType,
              stepIndex: s.stepIndex,
              displayName: s.displayName,
              status: "QUEUED" as const,
              stepConfig: s.stepConfig ?? Prisma.DbNull,
              onError: s.onError,
              timeoutMs: s.timeoutMs,
              retryMaxAttempts: s.retryMaxAttempts,
              retryBackoffMs: s.retryBackoffMs,
              retryBackoffType: s.retryBackoffType,
              enabled: s.enabled ?? true,
            })),
          },
        },
      },
      include: { stepRuns: { orderBy: { stepIndex: "asc" } } },
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Read                                                            */
  /* ---------------------------------------------------------------- */

  async getRunById(id: string) {
    return this.prisma.pipelineRun.findUnique({
      where: { id },
      include: { stepRuns: { orderBy: { stepIndex: "asc" } } },
    });
  }

  async getRunByIdOrThrow(id: string) {
    const run = await this.getRunById(id);
    if (!run) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Pipeline run not found.",
      });
    }
    return run;
  }

  async getRunForUser(userId: string, runId: string) {
    const run = await this.getRunByIdOrThrow(runId);
    if (run.createdById !== userId) {
      throw new UserFacingError({
        code: "FORBIDDEN",
        userMessage: "You do not have access to this pipeline run.",
      });
    }
    return run;
  }

  async listRunsForUser(
    userId: string,
    opts?: { limit?: number; offset?: number; status?: PipelineRunStatus },
  ) {
    const where: Prisma.PipelineRunWhereInput = {
      createdById: userId,
      ...(opts?.status && { status: opts.status }),
    };

    const [runs, total] = await this.prisma.$transaction([
      this.prisma.pipelineRun.findMany({
        where,
        include: { stepRuns: { orderBy: { stepIndex: "asc" } } },
        orderBy: { createdAt: "desc" },
        take: opts?.limit ?? 20,
        skip: opts?.offset ?? 0,
      }),
      this.prisma.pipelineRun.count({ where }),
    ]);

    return { runs, total };
  }

  async countRunningGlobal(): Promise<number> {
    return this.prisma.pipelineRun.count({
      where: {
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
  }

  async countRunningForCompany(companyId: string): Promise<number> {
    return this.prisma.pipelineRun.count({
      where: {
        companyId,
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Update — Run                                                    */
  /* ---------------------------------------------------------------- */

  async updateRunStatus(
    runId: string,
    status: PipelineRunStatus,
    extra?: {
      startedAt?: Date;
      finishedAt?: Date;
      errorMessage?: string;
      errorStepId?: string;
    },
  ) {
    return this.prisma.pipelineRun.update({
      where: { id: runId },
      data: {
        status,
        ...extra,
      },
    });
  }

  async updateRunCurrentStep(
    runId: string,
    currentStepId: string,
    currentStepIndex: number,
  ) {
    return this.prisma.pipelineRun.update({
      where: { id: runId },
      data: { currentStepId, currentStepIndex },
    });
  }

  /* ---------------------------------------------------------------- */
  /*  PipelineRunLead                                                 */
  /* ---------------------------------------------------------------- */

  async createRunLeads(pipelineRunId: string, leadIds: string[]) {
    if (leadIds.length === 0) return;
    return this.prisma.pipelineRunLead.createMany({
      data: leadIds.map((leadId) => ({ pipelineRunId, leadId })),
      skipDuplicates: true,
    });
  }

  async findActiveLeads(pipelineRunId: string) {
    return this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId, excluded: false },
      include: { lead: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async excludeLeads(
    pipelineRunId: string,
    leadIds: string[],
    excludedByStepId: string,
  ) {
    if (leadIds.length === 0) return;
    return this.prisma.pipelineRunLead.updateMany({
      where: {
        pipelineRunId,
        leadId: { in: leadIds },
      },
      data: { excluded: true, excludedByStepId },
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Update — Step                                                   */
  /* ---------------------------------------------------------------- */

  async updateStepStatus(
    runId: string,
    stepId: string,
    status: PipelineStepRunStatus,
    extra?: {
      startedAt?: Date;
      finishedAt?: Date;
      durationMs?: number;
      attempts?: number;
      outputSummary?: Prisma.InputJsonValue;
      errorMessage?: string;
    },
  ) {
    return this.prisma.pipelineStepRun.update({
      where: { pipelineRunId_stepId: { pipelineRunId: runId, stepId } },
      data: {
        status,
        ...extra,
      },
    });
  }

  async cancelRemainingSteps(runId: string, fromIndex: number) {
    return this.prisma.pipelineStepRun.updateMany({
      where: {
        pipelineRunId: runId,
        stepIndex: { gte: fromIndex },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: { status: "CANCELLED" },
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Outreach — junction table queries                                */
  /* ---------------------------------------------------------------- */

  /**
   * Get all outreach messages linked to a pipeline run.
   * Returns the junction rows with the full LeadConversationMessage included.
   */
  async findOutreachDrafts(pipelineRunId: string) {
    return this.prisma.pipelineRunOutreachMessage.findMany({
      where: { pipelineRunId },
      include: { message: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Find a specific junction link between a pipeline run and a message.
   * Returns null if the message is not linked to this run.
   */
  async findOutreachLink(pipelineRunId: string, messageId: string) {
    return this.prisma.pipelineRunOutreachMessage.findUnique({
      where: { pipelineRunId_messageId: { pipelineRunId, messageId } },
      include: { message: true },
    });
  }

  /**
   * Check whether an accepted (sentAt != null) message already exists
   * for a given lead within a pipeline run.
   */
  async hasAcceptedMessageForLead(
    pipelineRunId: string,
    leadId: string,
  ): Promise<boolean> {
    const count = await this.prisma.pipelineRunOutreachMessage.count({
      where: {
        pipelineRunId,
        message: { leadId, sentAt: { not: null } },
      },
    });
    return count > 0;
  }

  /**
   * Delete an outreach message. The junction row is removed
   * automatically via onDelete: Cascade on the message relation.
   */
  async deleteOutreachMessage(messageId: string) {
    return this.prisma.leadConversationMessage.delete({
      where: { id: messageId },
    });
  }

}
