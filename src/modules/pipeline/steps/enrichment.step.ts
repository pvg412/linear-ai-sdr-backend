import { inject, injectable } from "inversify";
import type { PrismaClient, Lead } from "@prisma/client";
import { EnrichmentFieldStatus } from "@prisma/client";

import { PROFILE_ENRICHMENT_TYPES } from "@/modules/profile-enrichment/profile-enrichment.types";
import type { ProfileEnrichmentCommandService } from "@/modules/profile-enrichment/services/profile-enrichment.command.service";

import { PIPELINE_CONFIG } from "@/modules/pipeline/pipeline.config";
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

const { batchSize: BATCH_SIZE, pollIntervalMs: POLL_INTERVAL_MS } = PIPELINE_CONFIG.enrichment;

/** Terminal statuses for enrichment — data is available once reached */
const ENRICHMENT_TERMINAL = new Set(["COMPLETED", "FAILED", "AWAITING_REVIEW"]);

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LeadEnrichmentResult {
  leadId: string;
  profileEnqueued: boolean;
  /** enrichmentRequestId returned by the service (for polling) */
  enrichmentRequestId?: string;
  errors: string[];
}

interface EnrichmentProgress {
  completed: number;
  total: number;
  profileRequests: number;
  errors: number;
}

/* ------------------------------------------------------------------ */
/*  Step implementation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Enrichment step — profile enrichment (LinkedIn profile scraping via Apify).
 *
 * For each lead that passed scoring, enqueues a BullMQ job for
 * profile enrichment.
 *
 * Processing is batched: leads within a batch run in parallel,
 * batches run sequentially. Progress is emitted after each batch.
 *
 * After all jobs are enqueued, the step polls the database until
 * every enrichment request reaches a terminal status (COMPLETED,
 * FAILED, or AWAITING_REVIEW). This ensures downstream steps have
 * enrichment data available in the DB.
 *
 * Note: Company research (Perplexity AI + LinkedIn posts) has been
 * moved to the signals step (signals.step.ts) so it can be
 * displayed alongside other signals in the UI.
 */
@injectable()
export class EnrichmentStep implements PipelineStepHandler {
  readonly type = "enrichment";

  private readonly prisma: PrismaClient = getPrisma();

  constructor(
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
        outputSummary: { totalLeads: 0, profileRequests: 0, errors: 0 },
      };
    }

    const includeProfileEnrichment = config.includeProfileEnrichment !== false;

    tools.emitProgress(`Enriching ${runLeads.length} lead(s)...`, { total: runLeads.length });

    // ── Phase 1: Batch-parallel enqueueing ───────────────────────────

    const allResults: LeadEnrichmentResult[] = [];
    let profileRequests = 0;
    let errorCount = 0;

    const batches = createBatches(runLeads, BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (await tools.checkCancelled()) break;

      const batch = batches[batchIdx];

      const batchResults = await Promise.all(
        batch.map((rl) =>
          this.enrichOneLead(rl.lead, ctx.createdById, includeProfileEnrichment, tools),
        ),
      );

      for (const result of batchResults) {
        allResults.push(result);
        if (result.profileEnqueued) profileRequests++;
        errorCount += result.errors.length;
      }

      const progress: EnrichmentProgress = {
        completed: allResults.length,
        total: runLeads.length,
        profileRequests,
        errors: errorCount,
      };

      tools.emitProgress(
        `Enriching leads: ${progress.completed}/${progress.total} enqueued ` +
          `(${progress.profileRequests} profile)`,
        progress,
      );
    }

    // ── Phase 2: Poll for completion ─────────────────────────────────

    const enrichmentIds = allResults
      .map((r) => r.enrichmentRequestId)
      .filter((id): id is string => !!id);

    if (enrichmentIds.length > 0) {
      tools.emitProgress(
        `Waiting for ${enrichmentIds.length} enrichment job(s) to complete...`,
      );

      await this.pollForCompletion(enrichmentIds, tools);
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

    // ── Log summary ──────────────────────────────────────────────────

    tools.log.info(
      {
        totalLeads: runLeads.length,
        profileRequests,
        errors: errorCount,
      },
      "Enrichment step completed",
    );

    // ── Return result ────────────────────────────────────────────────

    return {
      outputSummary: {
        totalLeads: runLeads.length,
        profileRequests,
        errors: errorCount,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Enrich a single lead: profile enrichment.
   * Returns the request ID so the caller can poll for completion.
   */
  private async enrichOneLead(
    lead: Lead,
    userId: string,
    includeProfileEnrichment: boolean,
    tools: PipelineTools,
  ): Promise<LeadEnrichmentResult> {
    const result: LeadEnrichmentResult = {
      leadId: lead.id,
      profileEnqueued: false,
      errors: [],
    };

    /* Profile Enrichment (requires linkedinUrl) */
    if (includeProfileEnrichment && lead.linkedinUrl) {
      try {
        // skipBilling=true: pipeline flat fee ($100) covers enrichment costs.
        const resp = await this.profileEnrichment.requestEnrichment(userId, lead.id, false, true);
        result.profileEnqueued = true;
        result.enrichmentRequestId = resp.enrichmentRequestId;
      } catch (err) {
        const msg = `Profile enrichment failed for lead ${lead.id}: ${(err as Error).message}`;
        tools.log.warn({ leadId: lead.id, error: msg }, msg);
        result.errors.push(msg);
      }
    }

    return result;
  }

  /**
   * Poll DB until all enrichment requests reach terminal statuses.
   * The step's overall timeout acts as the max wait — this loop does
   * not enforce its own ceiling.
   */
  private async pollForCompletion(
    enrichmentIds: string[],
    tools: PipelineTools,
  ): Promise<void> {
    const pendingEnrichment = new Set(enrichmentIds);

    while (pendingEnrichment.size > 0) {
      if (await tools.checkCancelled()) {
        tools.log.info({}, "Enrichment polling cancelled");
        return;
      }

      await sleep(POLL_INTERVAL_MS);

      const rows = await this.prisma.leadEnrichmentRequest.findMany({
        where: { id: { in: [...pendingEnrichment] } },
        select: { id: true, status: true },
      });

      for (const row of rows) {
        if (ENRICHMENT_TERMINAL.has(row.status)) {
          pendingEnrichment.delete(row.id);
        }
      }

      tools.emitProgress(
        `Waiting for enrichment: ${pendingEnrichment.size} profile enrichment remaining`,
        { pendingEnrichment: pendingEnrichment.size },
      );
    }

    tools.log.info(
      { enrichmentIds: enrichmentIds.length },
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
