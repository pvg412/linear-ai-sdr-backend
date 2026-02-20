import { inject, injectable } from "inversify";
import type { PrismaClient, Lead, CompanySize as PrismaCompanySize } from "@prisma/client";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";
import { getPrisma } from "@/infra/prisma";

import { SERVICE_CATALOG_TYPES } from "@/modules/service-catalog/service-catalog.types";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";

import { CompanySize as ProtoCompanySize } from "@/generated/aisdr/v1/ai_sdr";
import type {
  LeadProfileProto,
  ScoreLeadResponse,
  ServiceCatalogProto,
  ServiceCatalogSubServiceProto,
} from "@/generated/aisdr/v1/ai_sdr";

import { SCORING_CONSTANTS } from "@/config/constants";

import type { PipelineStepHandler } from "./step.interface";
import type {
  LeadReference,
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const { SCORING_THRESHOLD, BATCH_SIZE } = SCORING_CONSTANTS;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ScoredLead {
  leadId: string;
  score: number;
  reasoning: string;
  error?: string;
}

interface ScoringProgress {
  completed: number;
  total: number;
  passed: number;
  rejected: number;
}

/* ------------------------------------------------------------------ */
/*  Step implementation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Scoring step — AI-powered lead scoring.
 *
 * Evaluates each lead against the company's Service Catalogs via gRPC
 * `ScoreLead` method. Leads with score >= SCORING_THRESHOLD pass
 * through; the rest are filtered out.
 *
 * Processing is batched for parallelism: each batch of BATCH_SIZE
 * leads is scored via `Promise.all`, with progress emitted after
 * every batch completes.
 */
@injectable()
export class ScoringStep implements PipelineStepHandler {
  readonly type = "scoring";

  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    private readonly aiGrpcClient: AiGrpcClient,
    @inject(SERVICE_CATALOG_TYPES.ServiceCatalogRepository)
    private readonly serviceCatalogRepo: ServiceCatalogRepository,
  ) {}

  async run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const leads = ctx.data.leads ?? [];
    const stepInstanceId = config._stepId as string | undefined;
    const contextKey = stepInstanceId ?? "scoringResults";

    if (leads.length === 0) {
      tools.emitProgress("No leads to score");
      return {
        contextPatch: { [contextKey]: { scored: 0, passed: 0, rejected: 0 } },
        outputSummary: { total: 0, passedCount: 0, rejectedCount: 0, averageScore: 0 },
      };
    }

    // ── Step 1: Fetch full lead data from DB ─────────────────────────
    tools.emitProgress("Loading lead profiles...");

    const leadIds = leads.map((l) => l.id);
    const fullLeads = await this.prisma.lead.findMany({
      where: { id: { in: leadIds } },
    });

    const leadMap = new Map(fullLeads.map((l) => [l.id, l]));

    tools.log.info(
      { requested: leadIds.length, found: fullLeads.length },
      "Lead profiles loaded from DB",
    );

    // ── Step 2: Fetch service catalogs ───────────────────────────────
    tools.emitProgress("Loading service catalogs...");

    let serviceCatalogsProto: ServiceCatalogProto[] = [];
    if (ctx.companyId) {
      const catalogs = await this.serviceCatalogRepo.listByCompany(ctx.companyId);
      serviceCatalogsProto = catalogs.map((cat) => ({
        id: cat.id,
        name: cat.name,
        subServices: (cat.subServices ?? []).map(
          (sub): ServiceCatalogSubServiceProto => ({
            id: sub.id,
            name: sub.name,
            priority: sub.priority,
            budgetMin: sub.budgetMin,
            budgetMax: sub.budgetMax,
          }),
        ),
      }));
    }

    tools.log.info(
      { companyId: ctx.companyId, catalogCount: serviceCatalogsProto.length },
      "Service catalogs loaded",
    );

    if (await tools.checkCancelled()) return cancelledResult(contextKey);

    // ── Step 3: Batch-parallel scoring ───────────────────────────────
    tools.emitProgress("Scoring leads via AI...", { total: leads.length });

    const scoredLeads: ScoredLead[] = [];
    let passedCount = 0;
    let rejectedCount = 0;

    const batches = createBatches(leads, BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (await tools.checkCancelled()) {
        // Save whatever we have so far before returning
        if (scoredLeads.length > 0) {
          await this.persistScores(scoredLeads, ctx.pipelineRunId, stepInstanceId);
        }
        return cancelledResult(contextKey);
      }

      const batch = batches[batchIdx];

      const batchResults = await Promise.all(
        batch.map((leadRef) => this.scoreOneLead(leadRef, leadMap, serviceCatalogsProto)),
      );

      for (const result of batchResults) {
        scoredLeads.push(result);
        if (result.score >= SCORING_THRESHOLD) {
          passedCount++;
        } else {
          rejectedCount++;
        }
      }

      const progress: ScoringProgress = {
        completed: scoredLeads.length,
        total: leads.length,
        passed: passedCount,
        rejected: rejectedCount,
      };

      tools.emitProgress(
        `Scored ${progress.completed}/${progress.total} leads (${progress.passed} passed, ${progress.rejected} rejected)`,
        progress,
      );
    }

    // ── Step 4: Persist all scores to DB ─────────────────────────────
    tools.emitProgress("Saving scores to database...");

    await this.persistScores(scoredLeads, ctx.pipelineRunId, stepInstanceId);

    // ── Step 5: Filter & sort ────────────────────────────────────────
    const passed = scoredLeads
      .filter((s) => s.score >= SCORING_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    // Build filtered lead references for downstream steps
    const passedLeadRefs: LeadReference[] = passed.map((s) => {
      const original = leads.find((l) => l.id === s.leadId);
      return {
        id: s.leadId,
        fullName: original?.fullName ?? null,
        email: original?.email ?? null,
        company: original?.company ?? null,
        score: s.score,
        scoringReasoning: s.reasoning,
      };
    });

    // ── Step 6: Log summary ──────────────────────────────────────────
    const totalScore = scoredLeads.reduce((sum, s) => sum + s.score, 0);
    const averageScore = scoredLeads.length > 0
      ? Math.round(totalScore / scoredLeads.length)
      : 0;

    const errorCount = scoredLeads.filter((s) => s.error).length;

    tools.log.info(
      {
        total: scoredLeads.length,
        passed: passedCount,
        rejected: rejectedCount,
        averageScore,
        threshold: SCORING_THRESHOLD,
        errors: errorCount,
        stepInstanceId,
      },
      "Scoring step completed",
    );

    tools.emitProgress(
      `Scoring complete: ${passedCount} passed, ${rejectedCount} rejected (avg score: ${averageScore})`,
      { completed: scoredLeads.length, total: leads.length, passed: passedCount, rejected: rejectedCount },
    );

    // ── Step 7: Return result ────────────────────────────────────────
    return {
      contextPatch: {
        leads: passedLeadRefs,
        [contextKey]: {
          scored: scoredLeads.length,
          passed: passedCount,
          rejected: rejectedCount,
          averageScore,
          threshold: SCORING_THRESHOLD,
          errors: errorCount,
          details: scoredLeads.map((s) => {
            const ref = leads.find((l) => l.id === s.leadId);
            return {
              leadId: s.leadId,
              fullName: ref?.fullName ?? null,
              company: ref?.company ?? null,
              score: s.score,
              reasoning: s.reasoning,
              passed: s.score >= SCORING_THRESHOLD,
              error: s.error,
            };
          }),
        },
      },
      outputSummary: {
        total: scoredLeads.length,
        passedCount,
        rejectedCount,
        averageScore,
        threshold: SCORING_THRESHOLD,
        errors: errorCount,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Score a single lead via gRPC. On error, returns score=0 with the
   * error message as reasoning — the lead will be rejected but still
   * persisted for analytics.
   */
  private async scoreOneLead(
    leadRef: LeadReference,
    leadMap: Map<string, Lead>,
    serviceCatalogs: ServiceCatalogProto[],
  ): Promise<ScoredLead> {
    const fullLead = leadMap.get(leadRef.id);
    const profile = buildLeadProfile(leadRef, fullLead);

    try {
      const resp: ScoreLeadResponse = await this.aiGrpcClient.scoreLead({
        requestId: "",
        lead: profile,
        serviceCatalogs,
      });

      return {
        leadId: leadRef.id,
        score: clampScore(resp.score),
        reasoning: resp.reasoning ?? "",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        leadId: leadRef.id,
        score: 0,
        reasoning: `Scoring failed: ${msg}`,
        error: msg,
      };
    }
  }

  /**
   * Persist all scored leads to the LeadScore table.
   */
  private async persistScores(
    scored: ScoredLead[],
    pipelineRunId: string,
    stepInstanceId: string | undefined,
  ): Promise<void> {
    if (scored.length === 0) return;

    await this.prisma.leadScore.createMany({
      data: scored.map((s) => ({
        leadId: s.leadId,
        score: s.score,
        reasoning: s.reasoning || null,
        pipelineRunId,
        stepInstanceId: stepInstanceId ?? null,
      })),
      skipDuplicates: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

function cancelledResult(contextKey: string): PipelineStepResult {
  return {
    contextPatch: {
      leads: [],
      [contextKey]: { scored: 0, passed: 0, rejected: 0, cancelled: true },
    },
    outputSummary: { total: 0, passedCount: 0, rejectedCount: 0, cancelled: true },
  };
}

/** Split an array into batches of the given size. */
function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/** Clamp score to 0-100 range. */
function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Map Prisma CompanySize enum to proto CompanySize enum.
 *
 * The Prisma enum has finer granularity (9 buckets) while proto
 * has 6 buckets, so we map the closest match.
 */
function mapCompanySizeToProto(
  size: PrismaCompanySize | null | undefined,
): ProtoCompanySize {
  if (!size) return ProtoCompanySize.COMPANY_SIZE_UNSPECIFIED;

  switch (size) {
    case "SELF_EMPLOYED":
    case "STARTUP_1_10":
      return ProtoCompanySize.COMPANY_SIZE_1_10;
    case "SMALL_11_50":
      return ProtoCompanySize.COMPANY_SIZE_11_50;
    case "MEDIUM_51_200":
      return ProtoCompanySize.COMPANY_SIZE_51_200;
    case "LARGE_201_500":
      return ProtoCompanySize.COMPANY_SIZE_201_500;
    case "ENTERPRISE_501_1000":
      return ProtoCompanySize.COMPANY_SIZE_501_1000;
    case "CORPORATE_1001_5000":
    case "MEGA_5001_10000":
    case "GIANT_10000_PLUS":
      return ProtoCompanySize.COMPANY_SIZE_1000_PLUS;
    case "UNKNOWN":
    default:
      return ProtoCompanySize.COMPANY_SIZE_UNSPECIFIED;
  }
}

/**
 * Build a LeadProfileProto from context reference + full DB record.
 * Falls back to reference fields when the full lead is not available.
 */
function buildLeadProfile(
  ref: LeadReference,
  full: Lead | undefined,
): LeadProfileProto {
  if (!full) {
    return {
      id: ref.id,
      fullName: ref.fullName ?? "",
      title: "",
      headline: "",
      company: ref.company ?? "",
      companyIndustry: "",
      companySize: ProtoCompanySize.COMPANY_SIZE_UNSPECIFIED,
      companyDomain: "",
      location: "",
      companyLocation: "",
      seniorityLevel: "",
      department: "",
      linkedinUrl: "",
      yearsInPosition: 0,
      yearsInCompany: 0,
      totalExperienceYears: 0,
      currentPosition: "",
    };
  }

  return {
    id: full.id,
    fullName: full.fullName ?? "",
    title: full.title ?? "",
    headline: full.headline ?? "",
    company: full.company ?? "",
    companyIndustry: full.companyIndustry ?? "",
    companySize: mapCompanySizeToProto(full.companySize),
    companyDomain: full.companyDomain ?? "",
    location: full.location ?? "",
    companyLocation: full.companyLocation ?? "",
    seniorityLevel: full.seniorityLevel ?? "",
    department: full.department ?? "",
    linkedinUrl: full.linkedinUrl ?? "",
    yearsInPosition: full.yearsInPosition ?? 0,
    yearsInCompany: full.yearsInCompany ?? 0,
    totalExperienceYears: full.totalExperienceYears ?? 0,
    currentPosition: full.currentPosition ?? "",
  };
}
