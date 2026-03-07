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
  CrunchbaseSignalProto,
  HiringSignalProto,
  RedditSignalProto,
  LeadProfileProto,
  ScoreLeadFinalResponse,
  ServiceCatalogProto,
  ServiceCatalogSubServiceProto,
  SignalCategoryDescriptionProto,
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
} = FINAL_SCORING_CONSTANTS;

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
 * gRPC method, which receives the lead profile, service catalogs,
 * company research, and hiring signals for context.
 *
 * The composite final score is:
 *   finalScore = round(icpFit * ICP_FIT_WEIGHT + signalStrength * SIGNAL_STRENGTH_WEIGHT)
 *
 * If a lead has no initial score, icpFit defaults to 0.
 * If a lead's company has no hiring signals, signalStrength depends on
 * the AI's evaluation of other context (likely 0).
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

    // ── Step 4: Load ICP fit from initial scoring ────────────────────
    tools.emitProgress("Loading initial ICP scores...");

    const initialScoresByLead = await this.loadInitialScores(leadIds, ctx.pipelineRunId);

    tools.log.info(
      { leadsWithInitialScore: initialScoresByLead.size },
      "Initial ICP scores loaded for final scoring",
    );

    // ── Step 4b: Load signal category descriptions ─────────────────
    const signalCategoryDescriptions = await this.loadSignalCategoryDescriptions(ctx.companyId);

    tools.log.info(
      { descriptionsCount: signalCategoryDescriptions.length },
      "Signal category descriptions loaded for final scoring",
    );

    // ── Step 5: Load hiring signals ─────────────────────────────────
    tools.emitProgress("Loading hiring signals...");

    const hiringSignalsByLead = await this.loadHiringSignals(leadIds, ctx.pipelineRunId);

    tools.log.info(
      { leadsWithSignals: hiringSignalsByLead.size },
      "Hiring signals loaded for final scoring",
    );

    // ── Step 5b: Load Reddit signals ────────────────────────────────
    tools.emitProgress("Loading Reddit signals...");

    const redditSignalsByLead = await this.loadRedditSignals(leadIds, ctx.pipelineRunId);

    tools.log.info(
      { leadsWithRedditSignals: redditSignalsByLead.size },
      "Reddit signals loaded for final scoring",
    );

    // ── Step 5c: Load Crunchbase signals ─────────────────────────────
    tools.emitProgress("Loading Crunchbase signals...");

    const crunchbaseSignalsByLead = await this.loadCrunchbaseSignals(leadIds, ctx.pipelineRunId);

    tools.log.info(
      { leadsWithCrunchbaseSignals: crunchbaseSignalsByLead.size },
      "Crunchbase signals loaded for final scoring",
    );

    if (await tools.checkCancelled()) return cancelledResult();

    // ── Step 6: Batch-parallel signal strength scoring ───────────────
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
            companyResearchByLead.get(rl.leadId) ?? [],
            hiringSignalsByLead.get(rl.leadId),
            redditSignalsByLead.get(rl.leadId),
            crunchbaseSignalsByLead.get(rl.leadId),
            signalCategoryDescriptions,
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

    // ── Step 7: Persist all scores to DB ─────────────────────────────
    tools.emitProgress("Saving final scores to database...");

    await this.persistScores(scoredLeads, ctx.pipelineRunId, stepInstanceId);

    // ── Step 8: Log summary ────────────────────────────────────────────
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

    // ── Step 9: Return result ────────────────────────────────────────
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
    companyResearchItems: CompanyResearchItemProto[],
    hiringSignals?: HiringSignalProto,
    redditSignals?: RedditSignalProto,
    crunchbaseSignals?: CrunchbaseSignalProto,
    signalCategoryDescriptions: SignalCategoryDescriptionProto[] = [],
  ): Promise<FinalScoredLead> {
    const fullLead = leadMap.get(leadId);
    const profile = buildLeadProfile(leadId, fullLead);

    try {
      const resp: ScoreLeadFinalResponse = await this.aiGrpcClient.scoreLeadFinal({
        requestId: "",
        lead: profile,
        serviceCatalogs,
        companyResearchItems,
        hiringSignals,
        redditSignals,
        crunchbaseSignals,
        signalCategoryDescriptions,
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
   * Load hiring signals for the given lead IDs within a pipeline run.
   * Aggregates signals from all providers per lead into a single
   * HiringSignalProto suitable for the gRPC request.
   *
   * Returns a map of leadId -> HiringSignalProto (only for leads that
   * have at least one signal).
   */
  private async loadHiringSignals(
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<Map<string, HiringSignalProto>> {
    const signals = await this.prisma.hiringSignal.findMany({
      where: {
        leadId: { in: leadIds },
        pipelineRunId,
      },
      include: {
        jobs: {
          include: { locations: true },
        },
      },
    });

    // Group by leadId and merge results from multiple providers
    const byLead = new Map<string, HiringSignalProto>();

    for (const signal of signals) {
      const existing = byLead.get(signal.leadId);

      const signalJobs = signal.jobs.map((job) => ({
        jobTitle: job.jobTitle ?? "",
        team: job.team ?? "",
        jobType: job.jobType ?? "",
        locationType: job.locationType ?? "",
        datePosted: job.datePosted ?? "",
        requirementsSummary: job.requirementsSummary ?? "",
        skills: job.skills,
        technologies: job.technologies,
        jobCategories: job.jobCategories,
        locations: job.locations.map((loc) => ({
          city: loc.city ?? "",
          region: loc.region ?? "",
          country: loc.country ?? "",
        })),
      }));

      if (existing) {
        // Merge: sum job counts, union departments/titles, concat jobs
        existing.openJobCount += signal.openJobCount;
        const deptSet = new Set([...existing.departments, ...signal.departments]);
        existing.departments = Array.from(deptSet);
        const titleSet = new Set([...existing.topJobTitles, ...signal.topJobTitles]);
        existing.topJobTitles = Array.from(titleSet).slice(0, 10);
        existing.jobs.push(...signalJobs);
      } else {
        byLead.set(signal.leadId, {
          companyName: signal.companyName,
          openJobCount: signal.openJobCount,
          departments: [...signal.departments],
          topJobTitles: signal.topJobTitles.slice(0, 10),
          jobs: signalJobs,
        });
      }
    }

    return byLead;
  }

  /**
   * Load Reddit signals for the given lead IDs within a pipeline run.
   * Aggregates signals from all providers per lead into a single
   * RedditSignalProto suitable for the gRPC request.
   *
   * Returns a map of leadId -> RedditSignalProto (only for leads that
   * have at least one signal).
   */
  private async loadRedditSignals(
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<Map<string, RedditSignalProto>> {
    const signals = await this.prisma.redditSignal.findMany({
      where: {
        leadId: { in: leadIds },
        pipelineRunId,
      },
      include: { posts: true },
    });

    const byLead = new Map<string, RedditSignalProto>();

    for (const signal of signals) {
      const signalPosts = signal.posts.map((post: {
        subreddit: string;
        postType: string;
        signalType: string;
        title: string | null;
        content: string | null;
        author: string | null;
        url: string | null;
        score: number | null;
        numComments: number | null;
        createdUtc: string | null;
      }) => ({
        subreddit: post.subreddit,
        postType: post.postType,
        signalType: post.signalType,
        title: post.title ?? "",
        content: post.content ?? "",
        author: post.author ?? "",
        url: post.url ?? "",
        score: post.score ?? 0,
        numComments: post.numComments ?? 0,
        createdUtc: post.createdUtc ?? "",
      }));

      const existing = byLead.get(signal.leadId);
      if (existing) {
        existing.totalMentions += signal.totalMentions;
        existing.totalActivities += signal.totalActivities;
        const subSet = new Set([...existing.subredditsFound, ...signal.subredditsFound]);
        existing.subredditsFound = Array.from(subSet);
        existing.posts.push(...signalPosts);
      } else {
        byLead.set(signal.leadId, {
          companyName: signal.companyName,
          totalMentions: signal.totalMentions,
          totalActivities: signal.totalActivities,
          subredditsFound: [...signal.subredditsFound],
          posts: signalPosts,
        });
      }
    }

    return byLead;
  }

  /**
   * Load Crunchbase signals from the DB and map to proto format.
   * Returns a map of leadId → CrunchbaseSignalProto.
   *
   * Only one CrunchbaseSignal row per lead is expected (unique constraint
   * on [pipelineRunId, leadId, providerKey]). Leads with `crunchbaseFound: false`
   * are still included so the AI can see that Crunchbase was checked but no data was found.
   */
  private async loadCrunchbaseSignals(
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<Map<string, CrunchbaseSignalProto>> {
    const rows = await this.prisma.crunchbaseSignal.findMany({
      where: {
        leadId: { in: leadIds },
        pipelineRunId,
      },
    });

    const byLead = new Map<string, CrunchbaseSignalProto>();

    for (const row of rows) {
      // First row per lead wins (normally just one per provider)
      if (byLead.has(row.leadId)) continue;

      byLead.set(row.leadId, {
        companyName: row.companyName,
        crunchbaseFound: row.crunchbaseFound,
        crunchbasePermalink: row.crunchbasePermalink ?? "",
        fundingTotalUsd: row.fundingTotalUsd ?? 0,
        lastFundingAt: row.lastFundingAt ?? "",
        lastFundingType: row.lastFundingType ?? "",
        numFundingRounds: row.numFundingRounds ?? 0,
        growthScore: row.growthScore ?? 0,
        heatScore: row.heatScore ?? 0,
        fundingPrediction: row.fundingPrediction ?? 0,
        fundingPrediction0To5: row.fundingPrediction0to5 ?? 0,
        fundingPrediction6To11: row.fundingPrediction6to11 ?? 0,
        fundingPrediction12To24: row.fundingPrediction12to24 ?? 0,
        fundingPrediction24Plus: row.fundingPrediction24plus ?? 0,
        employeeCountEnum: row.employeeCountEnum ?? "",
        semrushVisits: row.semrushVisits ?? 0,
        shortDescription: row.shortDescription ?? "",
        foundedOn: row.foundedOn ?? "",
        operatingStatus: row.operatingStatus ?? "",
        categories: row.categories ?? "",
        numInvestors: row.numInvestors ?? 0,
        topCompetitors: row.topCompetitors ?? "",
        hadLayoffs: row.hadLayoffs,
        techStack: row.techStack ?? "",
        ipoPrediction: row.ipoPrediction ?? 0,
        acquisitionPrediction: row.acquisitionPrediction ?? 0,
      });
    }

    return byLead;
  }

  /**
   * Load company-defined signal category descriptions.
   * These tell the AI what the company cares about for each signal type
   * (e.g. "Job postings for Solidity developers..." for HIRING).
   *
   * Returns only categories that have a non-empty description.
   */
  private async loadSignalCategoryDescriptions(
    companyId: string | null,
  ): Promise<SignalCategoryDescriptionProto[]> {
    if (!companyId) return [];

    const configs = await this.prisma.signalCategoryConfig.findMany({
      where: { companyId, enabled: true },
      select: { category: true, description: true },
    });

    return configs
      .filter((c) => c.description && c.description.trim().length > 0)
      .map((c) => ({
        category: c.category,
        description: c.description,
      }));
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
