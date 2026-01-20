import { injectable } from "inversify";
import {
  LeadProvider,
  LeadSearchRunStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

@injectable()
export class LeadSearchRunRepository {
  private readonly prisma: PrismaClient = getPrisma();

  async getNextAttempt(
    leadSearchId: string,
    provider: LeadProvider,
  ): Promise<number> {
    const last = await this.prisma.leadSearchRun.findFirst({
      where: { leadSearchId, provider },
      orderBy: { attempt: "desc" },
      select: { attempt: true },
    });

    return (last?.attempt ?? 0) + 1;
  }

  async findLatestRunningRun(leadSearchId: string, provider: LeadProvider) {
    return this.prisma.leadSearchRun.findFirst({
      where: { leadSearchId, provider, status: LeadSearchRunStatus.RUNNING },
      orderBy: { attempt: "desc" },
    });
  }

  async findRunningRunByExternalRunId(input: {
    leadSearchId: string;
    provider: LeadProvider;
    externalRunId: string;
  }) {
    return this.prisma.leadSearchRun.findFirst({
      where: {
        leadSearchId: input.leadSearchId,
        provider: input.provider,
        status: LeadSearchRunStatus.RUNNING,
        externalRunId: input.externalRunId,
      },
      orderBy: { attempt: "desc" },
    });
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

  /**
   * Idempotent externalRunId set:
   * - if null => set
   * - if already set same => ok
   * - if already set different => throw (signals double-start bug)
   */
  async ensureExternalRunId(
    runId: string,
    externalRunId: string,
  ): Promise<void> {
    const curr = await this.prisma.leadSearchRun.findUnique({
      where: { id: runId },
      select: { externalRunId: true },
    });

    if (!curr) return;

    if (
      typeof curr.externalRunId === "string" &&
      curr.externalRunId.length > 0
    ) {
      if (curr.externalRunId !== externalRunId) {
        throw new Error(
          `LeadSearchRun.externalRunId mismatch (runId=${runId} existing=${curr.externalRunId} incoming=${externalRunId})`,
        );
      }
      return;
    }

    await this.prisma.leadSearchRun.update({
      where: { id: runId },
      data: { externalRunId },
    });
  }

  /**
   * Stores providerRunIds for long-running providers (e.g. chunked exports).
   * We persist it in `responseMeta` even while RUNNING so we can resume after restarts.
   *
   * Shape:
   *   responseMeta: { leadDb?: { providerRunIds?: string[] } }
   */
  async appendLeadDbProviderRunId(runId: string, providerRunId: string) {
    const curr = await this.prisma.leadSearchRun.findUnique({
      where: { id: runId },
      select: { responseMeta: true },
    });

    const meta: Record<string, unknown> = isRecord(curr?.responseMeta)
      ? { ...(curr?.responseMeta as Record<string, unknown>) }
      : {};

    const leadDb = isRecord(meta.leadDb) ? { ...meta.leadDb } : {};
    const existingIds = toStringArray(leadDb.providerRunIds);

    if (!existingIds.includes(providerRunId)) {
      existingIds.push(providerRunId);
    }

    leadDb.providerRunIds = existingIds;
    meta.leadDb = leadDb;

    await this.prisma.leadSearchRun.update({
      where: { id: runId },
      data: { responseMeta: meta as Prisma.InputJsonValue },
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
        externalRunId: input.externalRunId ?? undefined,
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
