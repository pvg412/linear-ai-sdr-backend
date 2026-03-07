import { injectable, multiInject, optional } from "inversify";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { HIRING_SIGNAL_TYPES } from "@/capabilities/hiring-signals/hiring-signals.types";
import type { SignalProvider } from "@/capabilities/hiring-signals/signal-provider.dto";
import { REDDIT_SIGNAL_TYPES } from "@/capabilities/reddit-signals/reddit-signals.types";
import type { RedditSignalProvider } from "@/capabilities/reddit-signals/reddit-signal-provider.dto";
import { CRUNCHBASE_SIGNAL_TYPES } from "@/capabilities/crunchbase-signals/crunchbase-signals.types";
import type { CrunchbaseSignalProvider } from "@/capabilities/crunchbase-signals/crunchbase-signal-provider.dto";

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

/**
 * Signals step — hiring + Reddit + Crunchbase signal detection.
 *
 * For each unique company represented in the active pipeline leads,
 * queries each configured signal provider for hiring data, Reddit
 * presence, and Crunchbase company data. Results are stored in
 * `HiringSignal` / `RedditSignal` / `CrunchbaseSignal` tables for
 * downstream use (e.g. final-scoring can load them to compute a
 * signal-strength score).
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
  ) {
    this.hiringProviders = hiringProviders ?? [];
    this.redditProviders = redditProviders ?? [];
    this.crunchbaseProviders = crunchbaseProviders ?? [];
  }

  async run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const enabledHiring = this.hiringProviders.filter((p) => p.isEnabled());
    const enabledReddit = this.redditProviders.filter((p) => p.isEnabled());
    const enabledCrunchbase = this.crunchbaseProviders.filter((p) => p.isEnabled());

    // ── 1. Skip fast if no providers are configured ──────────────────
    if (enabledHiring.length === 0 && enabledReddit.length === 0 && enabledCrunchbase.length === 0) {
      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId },
        "Signals step: no providers configured, skipping",
      );
      tools.emitProgress("Signal check skipped — no providers configured");
      return { outputSummary: { skipped: true, reason: "no_providers" } };
    }

    // ── 2. Load active leads ─────────────────────────────────────────
    const runLeads = await this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId: ctx.pipelineRunId, excluded: false },
      include: { lead: { select: { id: true, fullName: true, company: true, companyDomain: true } } },
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
    if (enabledReddit.length > 0) {
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

    // Phase A: Hiring
    const hiringResult = enabledHiring.length > 0
      ? await new HiringSignalProcessor(this.prisma, enabledHiring)
          .process(companyGroups, ctx.pipelineRunId, tools)
      : null;

    if (hiringResult?.cancelled) cancelled = true;

    // Phase B: Reddit
    const redditResult = !cancelled && enabledReddit.length > 0 && activeSubreddits.length > 0
      ? await new RedditSignalProcessor(this.prisma, enabledReddit)
          .process(companyGroups, activeSubreddits, ctx.pipelineRunId, tools)
      : null;

    if (redditResult?.cancelled) cancelled = true;

    // Check cancellation between Reddit and Crunchbase (matches original behaviour)
    if (!cancelled) cancelled = await tools.checkCancelled();

    // Phase C: Crunchbase
    const crunchbaseResult = !cancelled && enabledCrunchbase.length > 0
      ? await new CrunchbaseSignalProcessor(this.prisma, enabledCrunchbase)
          .process(companyGroups, ctx.pipelineRunId, tools)
      : null;

    // ── 6. Aggregate stats ───────────────────────────────────────────
    const companiesChecked = hiringResult?.companiesChecked ?? 0;
    const companiesWithHiringSignals = hiringResult?.companiesWithSignals ?? 0;
    const totalOpenRoles = hiringResult?.totalOpenRoles ?? 0;
    const companiesWithRedditSignals = redditResult?.companiesWithSignals ?? 0;
    const totalRedditMentions = redditResult?.totalMentions ?? 0;
    const companiesWithCrunchbaseData = crunchbaseResult?.companiesWithData ?? 0;
    const companiesWithoutCrunchbaseData = crunchbaseResult?.companiesWithoutData ?? 0;

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

    const summaryMessage = parts.length > 0 ? `Found ${parts.join("; ")}` : "No signals found";

    tools.emitProgress(summaryMessage, {
      checked: companiesChecked,
      withHiringSignals: companiesWithHiringSignals,
      withRedditSignals: companiesWithRedditSignals,
      withCrunchbaseData: companiesWithCrunchbaseData,
      openRoles: totalOpenRoles,
      redditMentions: totalRedditMentions,
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
      },
      "Signals step completed",
    );

    // ── 8. Build per-lead signal details for WS data ─────────────────
    const leadById = new Map(runLeads.map((rl) => [rl.lead.id, rl.lead]));

    const hiringDetails = hiringResult
      ? HiringSignalProcessor.buildWsDetails(hiringResult.detailsByLead, leadById)
      : [];
    const redditDetails = redditResult
      ? RedditSignalProcessor.buildWsDetails(redditResult.detailsByLead, leadById)
      : [];
    const crunchbaseDetails = crunchbaseResult
      ? CrunchbaseSignalProcessor.buildWsDetails(crunchbaseResult.detailsByLead, leadById)
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
        },
      },
    };
  }
}
