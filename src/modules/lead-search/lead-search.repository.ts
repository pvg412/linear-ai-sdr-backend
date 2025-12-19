import { injectable } from "inversify";
import {
  LeadProvider,
  LeadSearchRunStatus,
  LeadSearchStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class LeadSearchRepository {
  private readonly prisma: PrismaClient = getPrisma();

  getById(id: string) {
    return this.prisma.leadSearch.findUnique({
      where: { id },
    });
  }

  async markRunning(id: string): Promise<void> {
    await this.prisma.leadSearch.update({
      where: { id },
      data: {
        status: LeadSearchStatus.RUNNING,
        errorMessage: null,
      },
    });
  }

  async markDone(id: string, totalLeads: number): Promise<void> {
    await this.prisma.leadSearch.update({
      where: { id },
      data: {
        status:
          totalLeads > 0 ? LeadSearchStatus.DONE : LeadSearchStatus.DONE_NO_RESULTS,
        totalLeads,
        errorMessage: null,
      },
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.prisma.leadSearch.update({
      where: { id },
      data: {
        status: LeadSearchStatus.FAILED,
        errorMessage,
      },
    });
  }

  async getNextAttempt(leadSearchId: string, provider: LeadProvider): Promise<number> {
    const last = await this.prisma.leadSearchRun.findFirst({
      where: { leadSearchId, provider },
      orderBy: { attempt: "desc" },
      select: { attempt: true },
    });

    return (last?.attempt ?? 0) + 1;
  }

  async createRun(input: {
    leadSearchId: string;
    provider: LeadProvider;
    attempt: number;
    triggeredById?: string | null;
    requestPayload?: Prisma.InputJsonValue;
  }) {
    return this.prisma.leadSearchRun.create({
      data: {
        leadSearchId: input.leadSearchId,
        provider: input.provider,
        attempt: input.attempt,
        triggeredById: input.triggeredById ?? null,
        status: LeadSearchRunStatus.RUNNING,
        requestPayload: input.requestPayload ?? undefined,
      },
    });
  }

  async markRunSuccess(input: {
    runId: string;
    leadsCount: number;
    externalRunId?: string | null;
    responseMeta?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.leadSearchRun.update({
      where: { id: input.runId },
      data: {
        status: LeadSearchRunStatus.SUCCESS,
        errorMessage: null,
        leadsCount: input.leadsCount,
        externalRunId: input.externalRunId ?? null,
        responseMeta: input.responseMeta ?? undefined,
      },
    });
  }

  async markRunFailed(runId: string, errorMessage: string): Promise<void> {
    await this.prisma.leadSearchRun.update({
      where: { id: runId },
      data: {
        status: LeadSearchRunStatus.FAILED,
        errorMessage,
      },
    });
  }
}
