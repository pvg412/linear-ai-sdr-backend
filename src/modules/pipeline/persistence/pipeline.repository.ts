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
  input: Prisma.InputJsonValue | null;
  definition: Prisma.InputJsonValue;
  steps: Array<{
    stepId: string;
    stepType: string;
    stepIndex: number;
    displayName: string;
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
        input: input.input ?? Prisma.DbNull,
        definition: input.definition,
        context: Prisma.DbNull,
        stepRuns: {
          createMany: {
            data: input.steps.map((s) => ({
              stepId: s.stepId,
              stepType: s.stepType,
              stepIndex: s.stepIndex,
              displayName: s.displayName,
              status: "QUEUED" as const,
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

  async updateRunContext(runId: string, context: Prisma.InputJsonValue) {
    return this.prisma.pipelineRun.update({
      where: { id: runId },
      data: { context },
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
}
