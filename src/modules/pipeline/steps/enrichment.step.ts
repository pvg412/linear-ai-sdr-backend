import { inject, injectable } from "inversify";
import type { PrismaClient, Lead } from "@prisma/client";
import { EnrichmentFieldStatus } from "@prisma/client";

import { COMPANY_RESEARCH_TYPES } from "@/modules/company-research/company-research.types";
import type { CompanyResearchCommandService } from "@/modules/company-research/services/company-research.command.service";
import { PROFILE_ENRICHMENT_TYPES } from "@/modules/profile-enrichment/profile-enrichment.types";
import type { ProfileEnrichmentCommandService } from "@/modules/profile-enrichment/services/profile-enrichment.command.service";

import { ENRICHMENT_CONSTANTS } from "@/config/constants";
import { getPrisma } from "@/infra/prisma";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const { BATCH_SIZE, POLL_INTERVAL_MS } = ENRICHMENT_CONSTANTS;

/** Terminal statuses for enrichment — data is available once reached */
const ENRICHMENT_TERMINAL = new Set(["COMPLETED", "FAILED", "AWAITING_REVIEW"]);
/** Terminal statuses for company research */
const COMPANY_RESEARCH_TERMINAL = new Set(["COMPLETED", "FAILED"]);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LeadEnrichmentResult {
  leadId: string;
  profileEnqueued: boolean;
  companyResearchEnqueued: boolean;
  /** enrichmentRequestId returned by the service (for polling) */
  enrichmentRequestId?: string;
  /** companyResearchId returned by the service (for polling) */
  companyResearchId?: string;
  errors: string[];
}

interface EnrichmentProgress {
  completed: number;
  total: number;
  profileRequests: number;
  companyResearchRequests: number;
  errors: number;
}

/* ------------------------------------------------------------------ */
/*  Step implementation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Enrichment step — profile enrichment + company research.
 *
 * For each lead that passed scoring, enqueues two BullMQ jobs:
 *   1. Profile enrichment (LinkedIn profile scraping via Apify)
 *   2. Company research (Perplexity AI + LinkedIn posts)
 *
 * Processing is batched: leads within a batch run in parallel,
 * batches run sequentially. Progress is emitted after each batch.
 *
 * After all jobs are enqueued, the step polls the database until
 * every enrichment request and company research request reaches
 * a terminal status (COMPLETED, FAILED, or AWAITING_REVIEW for
 * enrichment). This ensures downstream steps have enrichment data
 * available in the DB.
 */
@injectable()
export class EnrichmentStep implements PipelineStepHandler {
  readonly type = "enrichment";

  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @inject(COMPANY_RESEARCH_TYPES.CompanyResearchCommandService)
    private readonly companyResearch: CompanyResearchCommandService,
    @inject(PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentCommandService)
    private readonly profileEnrichment: ProfileEnrichmentCommandService,
  ) {}

  async run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    // ── Load active leads from PipelineRunLead ───────────────────────
    const runLeads = await this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId: ctx.pipelineRunId, excluded: false },
      include: { lead: true },
      orderBy: { createdAt: "asc" },
    });

    if (runLeads.length === 0) {
      tools.emitProgress("No leads to enrich");
      return {
        outputSummary: { totalLeads: 0, profileRequests: 0, companyResearchRequests: 0, errors: 0 },
      };
    }

    const includeCompanyResearch = config.includeCompanyResearch !== false;
    const includeProfileEnrichment = config.includeProfileEnrichment !== false;
    const includeLinkedinPosts = config.includeLinkedinPosts !== false;

    tools.emitProgress(`Enriching ${runLeads.length} lead(s)...`, { total: runLeads.length });

    // ── Phase 1: Batch-parallel enqueueing ───────────────────────────

    const allResults: LeadEnrichmentResult[] = [];
    let profileRequests = 0;
    let companyResearchRequests = 0;
    let errorCount = 0;

    const batches = createBatches(runLeads, BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (await tools.checkCancelled()) break;

      const batch = batches[batchIdx];

      const batchResults = await Promise.all(
        batch.map((rl) =>
          this.enrichOneLead(rl.lead, ctx.createdById, includeProfileEnrichment, includeCompanyResearch, includeLinkedinPosts, tools),
        ),
      );

      for (const result of batchResults) {
        allResults.push(result);
        if (result.profileEnqueued) profileRequests++;
        if (result.companyResearchEnqueued) companyResearchRequests++;
        errorCount += result.errors.length;
      }

      const progress: EnrichmentProgress = {
        completed: allResults.length,
        total: runLeads.length,
        profileRequests,
        companyResearchRequests,
        errors: errorCount,
      };

      tools.emitProgress(
        `Enriching leads: ${progress.completed}/${progress.total} enqueued ` +
          `(${progress.profileRequests} profile, ${progress.companyResearchRequests} company research)`,
        progress,
      );
    }

    // ── Phase 2: Poll for completion ─────────────────────────────────

    const enrichmentIds = allResults
      .map((r) => r.enrichmentRequestId)
      .filter((id): id is string => !!id);
    const companyResearchIds = allResults
      .map((r) => r.companyResearchId)
      .filter((id): id is string => !!id);

    if (enrichmentIds.length > 0 || companyResearchIds.length > 0) {
      tools.emitProgress(
        `Waiting for ${enrichmentIds.length} enrichment + ${companyResearchIds.length} company research jobs to complete...`,
      );

      await this.pollForCompletion(enrichmentIds, companyResearchIds, tools);
    }

    // ── Phase 2.5: Auto-approve enrichment field changes ────────────
    //
    // In pipeline mode the manual review step is automated: all pending
    // field changes from profile enrichment are approved so that
    // lead data is updated before downstream steps (outreach, etc.).
    // This also triggers RAG re-indexing via the existing
    // reviewFieldChanges() → leadRagIndexSync path.

    if (enrichmentIds.length > 0) {
      await this.autoApproveEnrichmentFieldChanges(
        enrichmentIds,
        ctx.createdById,
        tools,
      );
    }

    // ── Phase 3: Fetch completed company research results ──────────

    const companyResearchByLead: Record<string, {
      company: string;
      items: Array<{
        date: string | null;
        summary: string;
        sourceUrl: string;
        category: string;
      }>;
    }> = {};

    if (companyResearchIds.length > 0) {
      tools.emitProgress("Collecting company research results...");

      const researchRecords = await this.prisma.companyResearch.findMany({
        where: { id: { in: companyResearchIds }, status: "COMPLETED" },
        select: {
          leadId: true,
          company: true,
          items: {
            select: {
              date: true,
              summary: true,
              sourceUrl: true,
              category: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      for (const record of researchRecords) {
        companyResearchByLead[record.leadId] = {
          company: record.company,
          items: record.items.map((item) => ({
            date: item.date,
            summary: item.summary,
            sourceUrl: item.sourceUrl,
            category: item.category.toLowerCase(),
          })),
        };
      }

      tools.log.info(
        { leadsWithResearch: Object.keys(companyResearchByLead).length },
        "Company research results collected",
      );
    }

    // ── Log summary ──────────────────────────────────────────────────

    tools.log.info(
      {
        totalLeads: runLeads.length,
        profileRequests,
        companyResearchRequests,
        errors: errorCount,
      },
      "Enrichment step completed",
    );

    // ── Build lead lookup for enrichment data ─────────────────────────

    const leadLookup = new Map(
      runLeads.map((rl) => [rl.leadId, rl.lead]),
    );

    // ── Return result ────────────────────────────────────────────────

    const companyResearchList = Object.entries(companyResearchByLead)
      .map(([leadId, research]) => {
        const lead = leadLookup.get(leadId);
        return {
          leadId,
          fullName: lead?.fullName ?? null,
          company: research.company,
          companyDomain: lead?.companyDomain ?? null,
          status: "COMPLETED",
          items: research.items,
        };
      })
      // Sort: leads with research items first, then by item count desc
      .sort((a, b) => b.items.length - a.items.length);

    return {
      outputSummary: {
        totalLeads: runLeads.length,
        profileRequests,
        companyResearchRequests,
        errors: errorCount,
      },
      data: {
        enrichment: {
          totalLeads: runLeads.length,
          leadsWithResearch: Object.keys(companyResearchByLead).length,
          companyResearch: companyResearchList,
        },
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Enrich a single lead: profile enrichment first, then company research.
   * Each operation is independently caught — one failure does not
   * prevent the other from running.
   *
   * Returns the request IDs so the caller can poll for completion.
   */
  private async enrichOneLead(
    lead: Lead,
    userId: string,
    includeProfileEnrichment: boolean,
    includeCompanyResearch: boolean,
    includeLinkedinPosts: boolean,
    tools: PipelineTools,
  ): Promise<LeadEnrichmentResult> {
    const result: LeadEnrichmentResult = {
      leadId: lead.id,
      profileEnqueued: false,
      companyResearchEnqueued: false,
      errors: [],
    };

    /* 1. Profile Enrichment (requires linkedinUrl) */
    if (includeProfileEnrichment && lead.linkedinUrl) {
      try {
        const resp = await this.profileEnrichment.requestEnrichment(userId, lead.id);
        result.profileEnqueued = true;
        result.enrichmentRequestId = resp.enrichmentRequestId;
      } catch (err) {
        const msg = `Profile enrichment failed for lead ${lead.id}: ${(err as Error).message}`;
        tools.log.warn({ leadId: lead.id, error: msg }, msg);
        result.errors.push(msg);
      }
    }

    /* 2. Company Research (requires company name) */
    if (includeCompanyResearch && lead.company) {
      try {
        const resp = await this.companyResearch.requestCompanyResearch(userId, lead.id, {
          recency: "month",
          maxResults: 5,
          includeLinkedinPosts,
        });
        result.companyResearchEnqueued = true;
        result.companyResearchId = resp.companyResearchId;
      } catch (err) {
        const msg = `Company research failed for lead ${lead.id}: ${(err as Error).message}`;
        tools.log.warn({ leadId: lead.id, error: msg }, msg);
        result.errors.push(msg);
      }
    }

    return result;
  }

  /**
   * Poll DB until all enrichment requests and company research requests
   * reach terminal statuses. The step's overall timeout (configured in
   * pipeline definition, default 10 min) acts as the max wait — this
   * loop does not enforce its own ceiling.
   */
  private async pollForCompletion(
    enrichmentIds: string[],
    companyResearchIds: string[],
    tools: PipelineTools,
  ): Promise<void> {
    const pendingEnrichment = new Set(enrichmentIds);
    const pendingResearch = new Set(companyResearchIds);

    while (pendingEnrichment.size > 0 || pendingResearch.size > 0) {
      if (await tools.checkCancelled()) {
        tools.log.info({}, "Enrichment polling cancelled");
        return;
      }

      await sleep(POLL_INTERVAL_MS);

      // ── Check enrichment requests ──────────────────────────────────
      if (pendingEnrichment.size > 0) {
        const rows = await this.prisma.leadEnrichmentRequest.findMany({
          where: { id: { in: [...pendingEnrichment] } },
          select: { id: true, status: true },
        });

        for (const row of rows) {
          if (ENRICHMENT_TERMINAL.has(row.status)) {
            pendingEnrichment.delete(row.id);
          }
        }
      }

      // ── Check company research requests ────────────────────────────
      if (pendingResearch.size > 0) {
        const rows = await this.prisma.companyResearch.findMany({
          where: { id: { in: [...pendingResearch] } },
          select: { id: true, status: true },
        });

        for (const row of rows) {
          if (COMPANY_RESEARCH_TERMINAL.has(row.status)) {
            pendingResearch.delete(row.id);
          }
        }
      }

      tools.emitProgress(
        `Waiting for enrichment: ${pendingEnrichment.size} profile + ${pendingResearch.size} company research remaining`,
        {
          pendingEnrichment: pendingEnrichment.size,
          pendingResearch: pendingResearch.size,
        },
      );
    }

    tools.log.info(
      { enrichmentIds: enrichmentIds.length, companyResearchIds: companyResearchIds.length },
      "All enrichment jobs completed",
    );
  }

  /**
   * Auto-approve all pending enrichment field changes for leads
   * that reached AWAITING_REVIEW status during this pipeline run.
   *
   * Uses the existing `reviewFieldChanges()` method from
   * ProfileEnrichmentCommandService so that:
   * - Field values are applied to the Lead model
   * - Enrichment request status transitions to COMPLETED
   * - hasPendingEnrichment flag is cleared
   * - RAG re-indexing is triggered (via leadRagIndexSync)
   *
   * Errors on individual leads are logged and swallowed — one lead
   * failing auto-approve must not block the rest.
   */
  private async autoApproveEnrichmentFieldChanges(
    enrichmentIds: string[],
    userId: string,
    tools: PipelineTools,
  ): Promise<void> {
    // Find enrichment requests that reached AWAITING_REVIEW
    const awaitingReview = await this.prisma.leadEnrichmentRequest.findMany({
      where: {
        id: { in: enrichmentIds },
        status: "AWAITING_REVIEW",
      },
      include: {
        fieldChanges: {
          where: { status: EnrichmentFieldStatus.PENDING },
        },
      },
    });

    if (awaitingReview.length === 0) {
      tools.log.info({}, "No enrichment requests awaiting review — skipping auto-approve");
      return;
    }

    tools.emitProgress(
      `Auto-approving enrichment for ${awaitingReview.length} lead(s)...`,
    );

    let approvedCount = 0;
    let failedCount = 0;

    for (const request of awaitingReview) {
      if (request.fieldChanges.length === 0) continue;

      try {
        const decisions = request.fieldChanges.map((fc) => ({
          fieldChangeId: fc.id,
          action: "approve" as const,
        }));

        await this.profileEnrichment.reviewFieldChanges(
          userId,
          request.leadId,
          decisions,
        );

        approvedCount++;
      } catch (err) {
        failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { leadId: request.leadId, enrichmentRequestId: request.id, error: msg },
          "Auto-approve failed for enrichment request (non-fatal)",
        );
      }
    }

    tools.log.info(
      { awaitingReview: awaitingReview.length, approved: approvedCount, failed: failedCount },
      "Enrichment auto-approve completed",
    );

    if (approvedCount > 0) {
      tools.emitProgress(
        `Auto-approved enrichment for ${approvedCount} lead(s)`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

/** Split an array into batches of the given size. */
function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
