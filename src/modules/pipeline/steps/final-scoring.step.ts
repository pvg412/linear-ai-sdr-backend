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
  ScoreLeadFinalResponse,
  ServiceCatalogProto,
  ServiceCatalogSubServiceProto,
  SignalCategoryDescriptionProto,
} from "@/generated/aisdr/v1/ai_sdr";

import { PIPELINE_CONFIG } from "@/modules/pipeline/pipeline.config";

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
  batchSize: BATCH_SIZE,
  icpFitWeight: ICP_FIT_WEIGHT,
  signalStrengthWeight: SIGNAL_STRENGTH_WEIGHT,
} = PIPELINE_CONFIG.finalScoring;

/** stepInstanceId written by the initial scoring step. */
const INITIAL_SCORING_STEP_ID = "scoring-initial";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** ICP fit data loaded from the initial scoring step's LeadScore row. */
interface InitialScoreData {
  score: number;
  reasoning: string | null;
}

interface FinalScoredLead {
  leadId: string;
  icpFit: number;
  icpReasoning: string;
  signalStrength: number;
  signalReasoning: string;
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
 * Final scoring step — combines ICP fit with AI-evaluated signal strength.
 *
 * ICP fit (0-100) is taken from the initial scoring step's `LeadScore`
 * record (stepInstanceId = "scoring-initial"). This step does NOT
 * re-evaluate ICP fit.
 *
 * Signal strength (0-100) is computed by the AI via the `ScoreLeadFinal`
 * gRPC method. The AI service retrieves signals (company research, hiring,
 * Reddit, Crunchbase) from ChromaDB using workspace_id + lead_id scoping,
 * so the backend no longer needs to load and send raw signal data.
 *
 * The composite final score is:
 *   finalScore = round(icpFit * ICP_FIT_WEIGHT + signalStrength * SIGNAL_STRENGTH_WEIGHT)
 *
 * If a lead has no initial score, icpFit defaults to 0.
 * If the AI cannot retrieve signals, signalStrength depends on whatever
 * was indexed in ChromaDB (likely 0 if nothing was indexed).
 *
 * All leads pass through (no threshold filtering) — the purpose of
 * final scoring is ranking, not elimination.
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

    // ── Step 2: Fetch service catalogs (with signal category descriptions) ─
    tools.emitProgress("Loading service catalogs...");

    // Resolve workspace ID: use companyId (the company account) so that
    // signals indexed under the company are retrievable regardless of which
    // user (COMPANY or SALE_MANAGER) triggered the pipeline.
    const workspaceId = ctx.companyId ?? ctx.createdById;

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
        signalCategoryDescriptions: (cat.signalCategories ?? [])
          .filter((sc) => sc.enabled && sc.description?.trim())
          .map((sc): SignalCategoryDescriptionProto => ({
            category: sc.category,
            description: sc.description,
            expandedDescription: (sc as { expandedDescription?: string | null }).expandedDescription ?? "",
          })),
      }));
    }

    tools.log.info(
      { companyId: ctx.companyId, workspaceId, catalogCount: serviceCatalogsProto.length },
      "Service catalogs loaded for final scoring",
    );

    if (await tools.checkCancelled()) return cancelledResult();

    // ── Step 3: Load ICP fit from initial scoring ────────────────────
    tools.emitProgress("Loading initial ICP scores...");

    const initialScoresByLead = await this.loadInitialScores(leadIds, ctx.pipelineRunId);

    tools.log.info(
      { leadsWithInitialScore: initialScoresByLead.size },
      "Initial ICP scores loaded for final scoring",
    );

    if (await tools.checkCancelled()) return cancelledResult();

    // ── Step 4: Batch-parallel signal strength scoring ───────────────
    // The AI service retrieves signals from ChromaDB via workspace_id + lead_id,
    // so we no longer load raw signal data from the DB here.
    tools.emitProgress("Evaluating signal strength via AI...", { total: runLeads.length });

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
        batch.map((rl) => {
          const initial = initialScoresByLead.get(rl.leadId);
          return this.scoreOneLead(
            rl.leadId,
            leadMap,
            initial?.score ?? 0,
            initial?.reasoning ?? "",
            serviceCatalogsProto,
            workspaceId,
          );
        }),
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
      data: {
        scoringFinal: {
          scored: scoredLeads.length,
          averageFinalScore,
          details: scoredLeads.map((s) => {
            const lead = leadMap.get(s.leadId);
            return {
              leadId: s.leadId,
              fullName: lead?.fullName ?? null,
              company: lead?.company ?? null,
              icpFit: s.icpFit,
              finalScore: s.finalScore,
              icpReasoning: s.icpReasoning,
              signalStrength: s.signalStrength,
            };
          }),
        },
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Evaluate signal strength for a single lead via gRPC ScoreLeadFinal,
   * then compute the composite finalScore from icpFit + signalStrength.
   *
   * The AI service retrieves all signals (company research, hiring, Reddit,
   * Crunchbase) from ChromaDB using workspace_id + lead_id scoping.
   *
   * `icpFit` and `icpReasoning` are loaded from the initial scoring
   * step's LeadScore row and passed in — the AI is NOT asked to
   * re-evaluate ICP fit here.
   *
   * On gRPC error, the initial icpFit is preserved but signalStrength
   * is set to 0. The lead still passes through (no filtering).
   */
  private async scoreOneLead(
    leadId: string,
    leadMap: Map<string, Lead>,
    icpFit: number,
    icpReasoning: string,
    serviceCatalogs: ServiceCatalogProto[],
    workspaceId: string,
  ): Promise<FinalScoredLead> {
    const fullLead = leadMap.get(leadId);
    const profile = buildLeadProfile(leadId, fullLead);

    try {
      const resp: ScoreLeadFinalResponse = await this.aiGrpcClient.scoreLeadFinal({
        requestId: "",
        lead: profile,
        serviceCatalogs,
        workspaceId,
        leadId,
      });

      const signalStrength = clampScore(resp.signalStrength);
      const finalScore = computeFinalScore(icpFit, signalStrength);

      return {
        leadId,
        icpFit,
        icpReasoning,
        signalStrength,
        signalReasoning: resp.signalReasoning ?? "",
        finalScore,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const finalScore = computeFinalScore(icpFit, 0);

      return {
        leadId,
        icpFit,
        icpReasoning,
        signalStrength: 0,
        signalReasoning: `Signal scoring failed: ${msg}`,
        finalScore,
        error: msg,
      };
    }
  }

  /**
   * Load ICP fit scores from the initial scoring step's LeadScore rows.
   * Returns a map of leadId -> { score, reasoning }.
   *
   * Only loads records with stepInstanceId = "scoring-initial" for the
   * current pipeline run. Leads without an initial score will be absent
   * from the map (caller defaults icpFit to 0).
   */
  private async loadInitialScores(
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<Map<string, InitialScoreData>> {
    const scores = await this.prisma.leadScore.findMany({
      where: {
        leadId: { in: leadIds },
        pipelineRunId,
        stepInstanceId: INITIAL_SCORING_STEP_ID,
      },
      select: { leadId: true, score: true, reasoning: true },
    });

    const result = new Map<string, InitialScoreData>();
    for (const s of scores) {
      // If duplicates exist (shouldn't), first wins
      if (!result.has(s.leadId)) {
        result.set(s.leadId, { score: s.score, reasoning: s.reasoning });
      }
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
