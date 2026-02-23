import { inject, injectable } from "inversify";
import type { PrismaClient, Lead, CompanySize as PrismaCompanySize } from "@prisma/client";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";
import { getPrisma } from "@/infra/prisma";

import { SERVICE_CATALOG_TYPES } from "@/modules/service-catalog/service-catalog.types";
import type { ServiceCatalogRepository } from "@/modules/service-catalog/persistence/service-catalog.repository";

import { CompanySize as ProtoCompanySize } from "@/generated/aisdr/v1/ai_sdr";
import type {
  CompanyResearchItemProto,
  LeadProfileProto,
  ScoreLeadFinalResponse,
  ServiceCatalogProto,
  ServiceCatalogSubServiceProto,
} from "@/generated/aisdr/v1/ai_sdr";

import { mapCategoryToProto } from "@/modules/company-research/utils/category-mapping";
import { FINAL_SCORING_CONSTANTS } from "@/config/constants";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const {
  BATCH_SIZE,
  ICP_FIT_WEIGHT,
  SIGNAL_STRENGTH_WEIGHT,
  SIGNAL_STRENGTH_STUB,
} = FINAL_SCORING_CONSTANTS;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FinalScoredLead {
  leadId: string;
  icpFit: number;
  icpReasoning: string;
  signalStrength: number;
  finalScore: number;
  error?: string;
}

interface FinalScoringProgress {
  completed: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Step implementation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Final scoring step — AI-powered lead scoring with enrichment context.
 *
 * Unlike the initial scoring step, this step sends enriched lead
 * profiles AND company research data to the AI via the `ScoreLeadFinal`
 * gRPC method for a higher-fidelity ICP fit evaluation.
 *
 * The composite final score is:
 *   finalScore = round(icpFit * ICP_FIT_WEIGHT + signalStrength * SIGNAL_STRENGTH_WEIGHT)
 *
 * Signal strength is currently a stub value (SIGNAL_STRENGTH_STUB)
 * until the signals step is fully implemented.
 *
 * All leads pass through (no threshold filtering) — the purpose of
 * final scoring is ranking, not elimination. Leads are sorted by
 * finalScore DESC in the output.
 */
@injectable()
export class FinalScoringStep implements PipelineStepHandler {
  readonly type = "final-scoring";

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
    const stepInstanceId = (config._stepId as string | undefined) ?? "scoring-final";

    // ── Load active leads from PipelineRunLead ───────────────────────
    const runLeads = await this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId: ctx.pipelineRunId, excluded: false },
      include: { lead: true },
      orderBy: { createdAt: "asc" },
    });

    if (runLeads.length === 0) {
      tools.emitProgress("No leads to score");
      return {
        outputSummary: { total: 0, averageFinalScore: 0 },
      };
    }

    // ── Build lead map from PipelineRunLead results ──────────────────
    const leadMap = new Map(runLeads.map((rl) => [rl.leadId, rl.lead]));
    const leadIds = runLeads.map((rl) => rl.leadId);

    tools.log.info(
      { activeLeads: runLeads.length },
      "Active leads loaded for final scoring",
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
      "Service catalogs loaded for final scoring",
    );

    // ── Step 3: Fetch company research data ──────────────────────────
    tools.emitProgress("Loading company research data...");

    const companyResearchByLead = await this.loadCompanyResearch(leadIds);

    tools.log.info(
      { leadsWithResearch: companyResearchByLead.size },
      "Company research data loaded",
    );

    if (await tools.checkCancelled()) return cancelledResult();

    // ── Step 4: Batch-parallel final scoring ─────────────────────────
    tools.emitProgress("Final scoring leads via AI...", { total: runLeads.length });

    const scoredLeads: FinalScoredLead[] = [];

    const batches = createBatches(runLeads, BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (await tools.checkCancelled()) {
        if (scoredLeads.length > 0) {
          await this.persistScores(scoredLeads, ctx.pipelineRunId, stepInstanceId);
        }
        return cancelledResult();
      }

      const batch = batches[batchIdx];

      const batchResults = await Promise.all(
        batch.map((rl) =>
          this.scoreOneLead(
            rl.leadId,
            leadMap,
            serviceCatalogsProto,
            companyResearchByLead.get(rl.leadId) ?? [],
          ),
        ),
      );

      scoredLeads.push(...batchResults);

      const progress: FinalScoringProgress = {
        completed: scoredLeads.length,
        total: runLeads.length,
      };

      tools.emitProgress(
        `Final scored ${progress.completed}/${progress.total} leads`,
        progress,
      );
    }

    // ── Step 5: Persist all scores to DB ─────────────────────────────
    tools.emitProgress("Saving final scores to database...");

    await this.persistScores(scoredLeads, ctx.pipelineRunId, stepInstanceId);

    // ── Step 6: Log summary ────────────────────────────────────────────
    const totalFinalScore = scoredLeads.reduce((sum, s) => sum + s.finalScore, 0);
    const averageFinalScore = scoredLeads.length > 0
      ? Math.round(totalFinalScore / scoredLeads.length)
      : 0;

    const errorCount = scoredLeads.filter((s) => s.error).length;

    tools.log.info(
      {
        total: scoredLeads.length,
        averageFinalScore,
        errors: errorCount,
        stepInstanceId,
      },
      "Final scoring step completed",
    );

    tools.emitProgress(
      `Final scoring complete: ${scoredLeads.length} leads scored (avg: ${averageFinalScore})`,
      { completed: scoredLeads.length, total: runLeads.length },
    );

    // ── Step 7: Return result ────────────────────────────────────────
    return {
      outputSummary: {
        total: scoredLeads.length,
        averageFinalScore,
        errors: errorCount,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Score a single lead via gRPC ScoreLeadFinal, then compute the
   * composite finalScore from icpFit + signalStrength.
   *
   * On error, returns icpFit=0 with the error message as reasoning —
   * the lead still passes through (no filtering) but will rank last.
   */
  private async scoreOneLead(
    leadId: string,
    leadMap: Map<string, Lead>,
    serviceCatalogs: ServiceCatalogProto[],
    companyResearchItems: CompanyResearchItemProto[],
  ): Promise<FinalScoredLead> {
    const fullLead = leadMap.get(leadId);
    const profile = buildLeadProfile(leadId, fullLead);

    // TODO: Replace with real signal strength once signals.step.ts is implemented
    const signalStrength = SIGNAL_STRENGTH_STUB;

    try {
      const resp: ScoreLeadFinalResponse = await this.aiGrpcClient.scoreLeadFinal({
        requestId: "",
        lead: profile,
        serviceCatalogs,
        companyResearchItems,
      });

      const icpFit = clampScore(resp.icpFit);
      const finalScore = computeFinalScore(icpFit, signalStrength);

      return {
        leadId,
        icpFit,
        icpReasoning: resp.icpReasoning ?? "",
        signalStrength,
        finalScore,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const finalScore = computeFinalScore(0, signalStrength);

      return {
        leadId,
        icpFit: 0,
        icpReasoning: `Final scoring failed: ${msg}`,
        signalStrength,
        finalScore,
        error: msg,
      };
    }
  }

  /**
   * Load completed company research items for the given lead IDs.
   * Returns a map of leadId -> CompanyResearchItemProto[].
   */
  private async loadCompanyResearch(
    leadIds: string[],
  ): Promise<Map<string, CompanyResearchItemProto[]>> {
    const researches = await this.prisma.companyResearch.findMany({
      where: {
        leadId: { in: leadIds },
        status: "COMPLETED",
      },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    const result = new Map<string, CompanyResearchItemProto[]>();

    for (const research of researches) {
      // Use the most recent completed research per lead
      if (result.has(research.leadId)) continue;

      const items: CompanyResearchItemProto[] = research.items.map((item, idx) => ({
        index: idx + 1,
        date: item.date ?? "",
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        category: mapCategoryToProto(item.category),
        sourceName: item.source ?? "",
      }));

      result.set(research.leadId, items);
    }

    return result;
  }

  /**
   * Persist all final-scored leads to the LeadScore table.
   * Uses the new icpFit, signalStrength, finalScore columns.
   * The `score` column stores the finalScore for backward compatibility.
   */
  private async persistScores(
    scored: FinalScoredLead[],
    pipelineRunId: string,
    stepInstanceId: string,
  ): Promise<void> {
    if (scored.length === 0) return;

    await this.prisma.leadScore.createMany({
      data: scored.map((s) => ({
        leadId: s.leadId,
        score: s.finalScore,
        reasoning: s.icpReasoning || null,
        pipelineRunId,
        stepInstanceId,
        icpFit: s.icpFit,
        signalStrength: s.signalStrength,
        finalScore: s.finalScore,
      })),
      skipDuplicates: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

function cancelledResult(): PipelineStepResult {
  return {
    outputSummary: { total: 0, averageFinalScore: 0, cancelled: true },
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

/** Compute the weighted composite final score. */
function computeFinalScore(icpFit: number, signalStrength: number): number {
  return Math.round(icpFit * ICP_FIT_WEIGHT + signalStrength * SIGNAL_STRENGTH_WEIGHT);
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
  leadId: string,
  full: Lead | undefined,
): LeadProfileProto {
  if (!full) {
    return {
      id: leadId,
      fullName: "",
      title: "",
      headline: "",
      company: "",
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
