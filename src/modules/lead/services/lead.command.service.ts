import { inject, injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import { ensureLogger, type LoggerLike } from "@/infra/observability";

import { LEAD_RAG_TYPES } from "@/modules/lead-rag/lead-rag.types";
import { LeadRagIndexSyncService } from "@/modules/lead-rag/services/lead-rag-index-sync.service";

export type LeadVerificationPatch = {
  id: string;
  isVerified: boolean;
};

@injectable()
export class LeadCommandService {
  constructor(
    @inject(LEAD_RAG_TYPES.LeadRagIndexSyncService)
    private readonly ragSync: LeadRagIndexSyncService,
  ) { }

  async setLeadsVerificationForLeadSearch(
    userId: string,
    input: {
      leadSearchId: string;
      companyId?: string | null;
      items: LeadVerificationPatch[];
    },
    log?: LoggerLike,
  ): Promise<{ updated: number }> {
    const lg = ensureLogger(log);
    const prisma = getPrisma();

    await this.assertLeadSearchAccessible(userId, input.leadSearchId, input.companyId);

    const unique = new Map<string, boolean>();
    for (const item of input.items) unique.set(item.id, item.isVerified);
    const leadIds = [...unique.keys()];

    if (leadIds.length === 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "items must contain at least one lead",
      });
    }

    const rels = await prisma.leadSearchLead.findMany({
      where: {
        leadSearchId: input.leadSearchId,
        leadId: { in: leadIds },
      },
      select: { leadId: true },
    });

    const existing = new Set(rels.map((r) => r.leadId));
    const missing = leadIds.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "Some leads do not belong to the provided leadSearchId",
        details: { missingLeadIds: missing },
      });
    }

    const toTrue: string[] = [];
    const toFalse: string[] = [];
    for (const [id, isVerified] of unique.entries()) {
      (isVerified ? toTrue : toFalse).push(id);
    }

    const res = await prisma.$transaction(async (tx) => {
      const [a, b] = await Promise.all([
        toTrue.length > 0
          ? tx.lead.updateMany({
            where: { id: { in: toTrue } },
            data: { isVerified: true },
          })
          : Promise.resolve({ count: 0 }),
        toFalse.length > 0
          ? tx.lead.updateMany({
            where: { id: { in: toFalse } },
            data: { isVerified: false },
          })
          : Promise.resolve({ count: 0 }),
      ]);

      return { updated: a.count + b.count };
    });

    try {
      if (toTrue.length > 0) {
        await this.ragSync.enqueueUpsertLeads(userId, toTrue, {
          reason: "lead.verify",
          log: lg,
        });
      }
    } catch (err) {
      lg.warn(
        { err, toTrueCount: toTrue.length, toFalseCount: toFalse.length },
        "LeadRag enqueue failed",
      );
    }

    return res;
  }

  private async assertLeadSearchAccessible(
    userId: string,
    leadSearchId: string,
    companyId?: string | null,
  ): Promise<void> {
    const prisma = getPrisma();

    const accessible = await prisma.leadSearch.findFirst({
      where: {
        id: leadSearchId,
        OR: companyId
          ? [{ createdById: userId }, { createdBy: { companyId } }]
          : [{ createdById: userId }],
      },
      select: { id: true },
    });

    if (!accessible) {
      throw new UserFacingError({
        code: "FORBIDDEN",
        userMessage: "LeadSearch not found or not accessible",
      });
    }
  }
}
