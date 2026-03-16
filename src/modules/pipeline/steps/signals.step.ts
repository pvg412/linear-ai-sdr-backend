import { injectable, multiInject, optional, inject } from "inversify";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { HIRING_SIGNAL_TYPES } from "@/capabilities/hiring-signals/hiring-signals.types";
import type { SignalProvider } from "@/capabilities/hiring-signals/signal-provider.dto";
import { REDDIT_SIGNAL_TYPES } from "@/capabilities/reddit-signals/reddit-signals.types";
import type { RedditSignalProvider } from "@/capabilities/reddit-signals/reddit-signal-provider.dto";
import { CRUNCHBASE_SIGNAL_TYPES } from "@/capabilities/crunchbase-signals/crunchbase-signals.types";
import type { CrunchbaseSignalProvider } from "@/capabilities/crunchbase-signals/crunchbase-signal-provider.dto";
import { COMPANY_RESEARCH_TYPES } from "@/modules/company-research/company-research.types";
import type { PerplexityClient } from "@/modules/company-research/services/perplexity.client";
import type { LinkedinPostsApifyClient } from "@/modules/company-research/services/linkedin-posts-apify.client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

import { buildCompanyGroups, pluralise } from "./signals/signals.helpers";
import { HiringSignalProcessor } from "./signals/hiring-signal.processor";
import { RedditSignalProcessor } from "./signals/reddit-signal.processor";
import { CrunchbaseSignalProcessor } from "./signals/crunchbase-signal.processor";
import { CompanyResearchProcessor } from "./signals/company-research.processor";
import {
  ALL_SIGNAL_CATEGORIES,
  SIGNAL_CATEGORY_PHASE_MAP,
  type ResolvedCategoryConfig,
} from "./signals/signal-category.map";

/**
 * Signals step — hiring + Reddit + Crunchbase signal detection
 * + company research (Perplexity AI news + LinkedIn posts).
 *
 * For each unique company represented in the active pipeline leads,
 * queries each configured signal provider for hiring data, Reddit
 * presence, Crunchbase company data, and company research (Perplexity
 * + optional LinkedIn posts via Apify).
 *
 * Results are stored in their respective DB tables for downstream use
 * (e.g. final-scoring loads them to compute a signal-strength score).
 *
 * Design constraints:
 * - All emitProgress messages are provider-agnostic (no brand names).
 * - Provider errors are logged and swallowed — never fail the pipeline.
 * - If a provider's daily limit is reached, it is silently skipped.
 * - Leads at the same company share a single API call (dedup by name).
 */
@injectable()
export class SignalsStep implements PipelineStepHandler {
  readonly type = "signals";

  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @multiInject(HIRING_SIGNAL_TYPES.SignalProvider)
    @optional()
    private readonly hiringProviders: SignalProvider[],

    @multiInject(REDDIT_SIGNAL_TYPES.RedditSignalProvider)
    @optional()
    private readonly redditProviders: RedditSignalProvider[],

    @multiInject(CRUNCHBASE_SIGNAL_TYPES.CrunchbaseSignalProvider)
    @optional()
    private readonly crunchbaseProviders: CrunchbaseSignalProvider[],

    @inject(COMPANY_RESEARCH_TYPES.PerplexityClient)
    @optional()
    private readonly perplexityClient: PerplexityClient | null,

    @inject(COMPANY_RESEARCH_TYPES.LinkedinPostsApifyClient)
    @optional()
    private readonly linkedinPostsClient: LinkedinPostsApifyClient | null,

    @inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    @optional()
    private readonly aiGrpcClient: AiGrpcClient | null,
  ) {
    this.hiringProviders = hiringProviders ?? [];
    this.redditProviders = redditProviders ?? [];
    this.crunchbaseProviders = crunchbaseProviders ?? [];
    this.perplexityClient = perplexityClient ?? null;
    this.linkedinPostsClient = linkedinPostsClient ?? null;
    this.aiGrpcClient = aiGrpcClient ?? null;
  }

  async run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const enabledHiring = this.hiringProviders.filter((p) => p.isEnabled());
    const enabledReddit = this.redditProviders.filter((p) => p.isEnabled());
    const enabledCrunchbase = this.crunchbaseProviders.filter((p) => p.isEnabled());

    // ── Company research config flags ────────────────────────────────
    const includeCompanyResearch = config.includeCompanyResearch !== false;
    const includeLinkedinPosts = config.includeLinkedinPosts !== false;
    const perplexityRecency = (config.perplexityRecency as "day" | "week" | "month" | "year") ?? "month";
    const perplexityMaxResults = typeof config.perplexityMaxResults === "number" ? config.perplexityMaxResults : 5;

    // Extract to locals so TypeScript can narrow nullability in the ternary below
    const perplexityClient = this.perplexityClient;
    const aiGrpcClient = this.aiGrpcClient;

    const companyResearchEnabled =
      includeCompanyResearch &&
      !!perplexityClient &&
      !!aiGrpcClient;

    // ── 1. Skip fast if no providers/research configured ────────────
    if (
      enabledHiring.length === 0 &&
      enabledReddit.length === 0 &&
      enabledCrunchbase.length === 0 &&
      !companyResearchEnabled
    ) {
      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId },
        "Signals step: no providers configured, skipping",
      );
      tools.emitProgress("Signal check skipped — no providers configured");
      return { outputSummary: { skipped: true, reason: "no_providers" } };
    }

    // ── 1b. Load company signal category configuration ───────────────
    const categoryConfigs = await this.loadCategoryConfigs(ctx.companyId);
    const disabledPhases = new Set(
      categoryConfigs
        .filter((c) => !c.enabled)
        .map((c) => SIGNAL_CATEGORY_PHASE_MAP[c.category]),
    );

    const hiringEnabled = enabledHiring.length > 0 && !disabledPhases.has("hiring");
    const redditEnabled = enabledReddit.length > 0 && !disabledPhases.has("reddit");
    const crunchbaseEnabled = enabledCrunchbase.length > 0 && !disabledPhases.has("crunchbase");

    if (!hiringEnabled && !redditEnabled && !crunchbaseEnabled && !companyResearchEnabled) {
      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId },
        "Signals step: all categories disabled by company config, skipping",
      );
      tools.emitProgress("Signal check skipped — all signal categories disabled");
      return { outputSummary: { skipped: true, reason: "all_categories_disabled" } };
    }

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        hiringEnabled,
        redditEnabled,
        crunchbaseEnabled,
        companyResearchEnabled,
        disabledPhases: [...disabledPhases],
      },
      "Signals step: category configuration resolved",
    );

    // ── 2. Load active leads (include companyLinkedinUrl for research) ─
    const runLeads = await this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId: ctx.pipelineRunId, excluded: false },
      include: {
        lead: {
          select: {
            id: true,
            fullName: true,
            company: true,
            companyDomain: true,
            companyLinkedinUrl: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (runLeads.length === 0) {
      tools.emitProgress("No leads to check for signals");
      return {
        outputSummary: { companiesChecked: 0, hiringSignalsFound: 0, redditSignalsFound: 0 },
      };
    }

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, leadCount: runLeads.length },
      "Signals step: loaded active leads",
    );

    // ── 3. Load active subreddits for Reddit providers ───────────────
    let activeSubreddits: string[] = [];
    if (redditEnabled) {
      const sources = await this.prisma.monitoredSource.findMany({
        where: { channel: "REDDIT", enabled: true },
        select: { value: true },
      });
      activeSubreddits = sources.map((s: { value: string }) => s.value);

      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId, subredditCount: activeSubreddits.length },
        "Signals step: loaded active subreddits",
      );
    }

    // ── 4. Deduplicate by company name ───────────────────────────────
    const companyGroups = buildCompanyGroups(runLeads);
    const uniqueCompanies = companyGroups.size;

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, uniqueCompanies },
      "Signals step: unique companies to check",
    );

    tools.emitProgress("Checking signals...", { companies: uniqueCompanies });

    // ── 5. Run signal phases ─────────────────────────────────────────
    let cancelled = false;

    // Resolve workspace ID: use companyId so that signals are indexed under the
    // company account and visible to all users (COMPANY + SALE_MANAGERs).
    const workspaceId = ctx.companyId ?? ctx.createdById;

    // Phase A: Hiring (category: HIRING)
    const hiringResult = hiringEnabled
      ? await new HiringSignalProcessor(this.prisma, enabledHiring, aiGrpcClient)
          .process(companyGroups, ctx.pipelineRunId, tools, workspaceId)
      : null;

    if (hiringResult?.cancelled) cancelled = true;

    // Phase B: Reddit (category: COMMUNITY)
    const redditResult = !cancelled && redditEnabled && activeSubreddits.length > 0
      ? await new RedditSignalProcessor(this.prisma, enabledReddit, aiGrpcClient)
          .process(companyGroups, activeSubreddits, ctx.pipelineRunId, tools, workspaceId)
      : null;

    if (redditResult?.cancelled) cancelled = true;

    // Check cancellation between Reddit and Crunchbase
    if (!cancelled) cancelled = await tools.checkCancelled();

    // Phase C: Crunchbase (category: FUNDING)
    const crunchbaseResult = !cancelled && crunchbaseEnabled
      ? await new CrunchbaseSignalProcessor(this.prisma, enabledCrunchbase, aiGrpcClient)
          .process(companyGroups, ctx.pipelineRunId, tools, workspaceId)
      : null;

    if (!cancelled) cancelled = await tools.checkCancelled();

    // Phase D: Company Research (Perplexity + LinkedIn posts)
    const leadById = new Map(
      runLeads.map((rl) => [
        rl.lead.id,
        {
          id: rl.lead.id,
          fullName: rl.lead.fullName,
          company: rl.lead.company,
          companyDomain: rl.lead.companyDomain,
          companyLinkedinUrl: rl.lead.companyLinkedinUrl,
        },
      ]),
    );

    const companyResearchResult =
      !cancelled && companyResearchEnabled
        ? await new CompanyResearchProcessor(
            this.prisma,
            perplexityClient,
            this.linkedinPostsClient ?? this.createDisabledLinkedinClient(),
            aiGrpcClient,
          ).process(
            companyGroups,
            leadById,
            workspaceId,
            ctx.pipelineRunId,
            tools,
            {
              includeLinkedinPosts: includeLinkedinPosts && !!this.linkedinPostsClient,
              recency: perplexityRecency,
              maxResults: perplexityMaxResults,
            },
          )
        : null;

    // ── 6. Aggregate stats ───────────────────────────────────────────
    const companiesChecked = hiringResult?.companiesChecked ?? 0;
    const companiesWithHiringSignals = hiringResult?.companiesWithSignals ?? 0;
    const totalOpenRoles = hiringResult?.totalOpenRoles ?? 0;
    const companiesWithRedditSignals = redditResult?.companiesWithSignals ?? 0;
    const totalRedditMentions = redditResult?.totalMentions ?? 0;
    const companiesWithCrunchbaseData = crunchbaseResult?.companiesWithData ?? 0;
    const companiesWithoutCrunchbaseData = crunchbaseResult?.companiesWithoutData ?? 0;
    const companiesWithResearch = companyResearchResult?.companiesWithPerplexity ?? 0;
    const companiesWithLinkedinPosts = companyResearchResult?.companiesWithLinkedinPosts ?? 0;
    const totalLinkedinPosts = companyResearchResult?.totalLinkedinPosts ?? 0;

    // ── 7. Summary ───────────────────────────────────────────────────
    const parts: string[] = [];
    if (companiesWithHiringSignals > 0) {
      parts.push(
        `${companiesWithHiringSignals} ${pluralise("company", "companies", companiesWithHiringSignals)} with active hiring (${totalOpenRoles} open ${pluralise("role", "roles", totalOpenRoles)})`,
      );
    }
    if (companiesWithRedditSignals > 0) {
      parts.push(
        `${companiesWithRedditSignals} ${pluralise("company", "companies", companiesWithRedditSignals)} with Reddit presence (${totalRedditMentions} ${pluralise("mention", "mentions", totalRedditMentions)})`,
      );
    }
    if (companiesWithCrunchbaseData > 0) {
      parts.push(
        `${companiesWithCrunchbaseData} ${pluralise("company", "companies", companiesWithCrunchbaseData)} with company data`,
      );
    }
    if (companiesWithResearch > 0) {
      parts.push(
        `${companiesWithResearch} ${pluralise("company", "companies", companiesWithResearch)} researched` +
          (companiesWithLinkedinPosts > 0 ? ` (${totalLinkedinPosts} LinkedIn ${pluralise("post", "posts", totalLinkedinPosts)})` : ""),
      );
    }

    const summaryMessage = parts.length > 0 ? `Found ${parts.join("; ")}` : "No signals found";

    tools.emitProgress(summaryMessage, {
      checked: companiesChecked,
      withHiringSignals: companiesWithHiringSignals,
      withRedditSignals: companiesWithRedditSignals,
      withCrunchbaseData: companiesWithCrunchbaseData,
      openRoles: totalOpenRoles,
      redditMentions: totalRedditMentions,
      withResearch: companiesWithResearch,
      withLinkedinPosts: companiesWithLinkedinPosts,
      linkedinPosts: totalLinkedinPosts,
    });

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        companiesChecked,
        companiesWithHiringSignals,
        companiesWithRedditSignals,
        companiesWithCrunchbaseData,
        companiesWithoutCrunchbaseData,
        totalOpenRoles,
        totalRedditMentions,
        companiesWithResearch,
        companiesWithLinkedinPosts,
        totalLinkedinPosts,
      },
      "Signals step completed",
    );

    // ── 8. Build per-lead signal details for WS data ─────────────────
    const leadByIdSimple = new Map(
      runLeads.map((rl) => [
        rl.lead.id,
        {
          id: rl.lead.id,
          fullName: rl.lead.fullName,
          company: rl.lead.company,
          companyDomain: rl.lead.companyDomain,
        },
      ]),
    );

    const hiringDetails = hiringResult
      ? HiringSignalProcessor.buildWsDetails(hiringResult.detailsByLead, leadByIdSimple)
      : [];
    const redditDetails = redditResult
      ? RedditSignalProcessor.buildWsDetails(redditResult.detailsByLead, leadByIdSimple)
      : [];
    const crunchbaseDetails = crunchbaseResult
      ? CrunchbaseSignalProcessor.buildWsDetails(crunchbaseResult.detailsByLead, leadByIdSimple)
      : [];
    const companyResearchDetails = companyResearchResult
      ? CompanyResearchProcessor.buildWsDetails(companyResearchResult.detailsByLead, leadByIdSimple)
      : [];

    return {
      outputSummary: {
        companiesChecked,
        companiesWithHiringSignals,
        companiesWithRedditSignals,
        companiesWithCrunchbaseData,
        companiesWithoutCrunchbaseData,
        totalOpenRoles,
        totalRedditMentions,
        companiesWithResearch,
        companiesWithLinkedinPosts,
        totalLinkedinPosts,
        leadsProcessed: runLeads.length,
      },
      data: {
        signals: {
          hiring: {
            leadsWithSignals: hiringResult?.detailsByLead.size ?? 0,
            totalOpenRoles,
            details: hiringDetails,
          },
          reddit: {
            leadsWithSignals: redditResult?.detailsByLead.size ?? 0,
            totalMentions: totalRedditMentions,
            details: redditDetails,
          },
          crunchbase: {
            leadsWithData: crunchbaseResult?.detailsByLead.size ?? 0,
            companiesFound: companiesWithCrunchbaseData,
            companiesNotFound: companiesWithoutCrunchbaseData,
            details: crunchbaseDetails,
          },
          companyResearch: {
            leadsWithResearch: companyResearchResult?.detailsByLead.size ?? 0,
            companiesResearched: companiesWithResearch,
            companiesWithLinkedinPosts,
            totalLinkedinPosts,
            details: companyResearchDetails,
          },
        },
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Load the company's signal category configuration across all service catalogs.
   *
   * A category is considered enabled if ANY service catalog has it enabled.
   * This ensures signals are collected whenever at least one catalog cares
   * about a given signal type.
   *
   * Categories without any saved config across any catalog default to
   * enabled: true (backward-compatible behaviour).
   */
  private async loadCategoryConfigs(
    companyId: string | null,
  ): Promise<ResolvedCategoryConfig[]> {
    if (!companyId) {
      return ALL_SIGNAL_CATEGORIES.map((cat) => ({
        category: cat,
        enabled: true,
        description: null,
      }));
    }

    const saved = await this.prisma.signalCategoryConfig.findMany({
      where: { serviceCatalog: { companyId } },
    });

    // A category is enabled if ANY catalog has it enabled
    const enabledCategories = new Set(
      saved.filter((s) => s.enabled).map((s) => s.category),
    );

    // Categories that have at least one saved config row
    const configuredCategories = new Set(saved.map((s) => s.category));

    return ALL_SIGNAL_CATEGORIES.map((cat) => ({
      category: cat,
      // If no catalog has configured this category at all, default to enabled
      enabled: configuredCategories.has(cat) ? enabledCategories.has(cat) : true,
      // description is not used in the signals step (only for final scoring)
      description: null,
    }));
  }

  /**
   * Returns a no-op LinkedIn client used when LinkedIn posts are disabled
   * but a CompanyResearchProcessor instance is still needed.
   */
  private createDisabledLinkedinClient(): LinkedinPostsApifyClient {
    return {
      fetchCompanyPosts: () => Promise.resolve({ items: [] }),
    } as unknown as LinkedinPostsApifyClient;
  }
}
