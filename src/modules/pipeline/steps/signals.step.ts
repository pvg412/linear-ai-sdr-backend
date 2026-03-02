import { injectable, multiInject, optional } from "inversify";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { HIRING_SIGNAL_TYPES } from "@/capabilities/hiring-signals/hiring-signals.types";
import type {
  SignalProvider,
  HiringSignalResult,
  SignalJobDto,
} from "@/capabilities/hiring-signals/signal-provider.dto";
import { REDDIT_SIGNAL_TYPES } from "@/capabilities/reddit-signals/reddit-signals.types";
import type {
  RedditSignalProvider,
  RedditSignalResult,
  RedditSignalPostDto,
} from "@/capabilities/reddit-signals/reddit-signal-provider.dto";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

/** Keyed by normalised company name (lowercased trim). */
type CompanyGroup = {
  /** Original company name string as stored on the lead. */
  companyName: string;
  companyDomain: string | null | undefined;
  leadIds: string[];
};

/* ------------------------------------------------------------------ */
/*  Step                                                                */
/* ------------------------------------------------------------------ */

/**
 * Signals step — hiring + Reddit signal detection.
 *
 * For each unique company represented in the active pipeline leads,
 * queries each configured signal provider for hiring data and Reddit
 * presence. Results are stored in `HiringSignal` / `RedditSignal`
 * tables for downstream use (e.g. final-scoring can load them to
 * compute a signal-strength score).
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
  ) {
    // @optional() allows the step to function even if no providers are
    // registered (e.g. in tests or when all API keys are absent).
    this.hiringProviders = hiringProviders ?? [];
    this.redditProviders = redditProviders ?? [];
  }

  async run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const enabledHiringProviders = this.hiringProviders.filter((p) => p.isEnabled());
    const enabledRedditProviders = this.redditProviders.filter((p) => p.isEnabled());

    const hasAnyProvider = enabledHiringProviders.length > 0 || enabledRedditProviders.length > 0;

    // ── 1. Skip fast if no providers are configured ──────────────────
    if (!hasAnyProvider) {
      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId },
        "Signals step: no providers configured, skipping",
      );
      tools.emitProgress("Signal check skipped — no providers configured");
      return {
        outputSummary: { skipped: true, reason: "no_providers" },
      };
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
    if (enabledRedditProviders.length > 0) {
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

    tools.emitProgress("Checking signals...", {
      companies: uniqueCompanies,
    });

    // ── 5. Per-company signal lookup (parallelized) ─────────────────
    const COMPANY_CONCURRENCY = 5;

    let companiesChecked = 0;
    let companiesWithHiringSignals = 0;
    let companiesWithRedditSignals = 0;
    let totalOpenRoles = 0;
    let totalRedditMentions = 0;

    /** Collect per-lead hiring signal details for WS data */
    const hiringDetailsByLead = new Map<
      string,
      { openJobCount: number; departments: Set<string>; topJobTitles: Set<string>; jobs: SignalJobDto[] }
    >();

    /** Collect per-lead Reddit signal details for WS data */
    const redditDetailsByLead = new Map<
      string,
      { totalMentions: number; subredditsFound: Set<string>; posts: RedditSignalPostDto[] }
    >();

    let cancelled = false;

    const processCompany = async (group: CompanyGroup): Promise<void> => {
      if (cancelled) return;
      if (await tools.checkCancelled()) {
        cancelled = true;
        tools.log.info(
          { pipelineRunId: ctx.pipelineRunId },
          "Signals step: cancelled during company loop",
        );
        return;
      }

      // Run hiring + Reddit signals in parallel for this company
      const [hiringResults, redditResults] = await Promise.all([
        enabledHiringProviders.length > 0
          ? this.fetchHiringSignals(group, enabledHiringProviders, tools)
          : Promise.resolve([] as HiringSignalResult[]),
        enabledRedditProviders.length > 0 && activeSubreddits.length > 0
          ? this.fetchRedditSignals(group, enabledRedditProviders, activeSubreddits, tools)
          : Promise.resolve([] as RedditSignalResult[]),
      ]);

      // ── Process hiring results ──────────────────────────────────
      if (hiringResults.length > 0) {
        companiesWithHiringSignals++;
        const companyOpenRoles = hiringResults.reduce((sum, r) => sum + r.openJobCount, 0);
        totalOpenRoles += companyOpenRoles;

        const allDepts = new Set(hiringResults.flatMap((r) => r.departments));
        const allTitles = new Set(hiringResults.flatMap((r) => r.topJobTitles));
        const allJobs = hiringResults.flatMap((r) => r.jobs);

        for (const leadId of group.leadIds) {
          const existing = hiringDetailsByLead.get(leadId);
          if (existing) {
            existing.openJobCount += companyOpenRoles;
            allDepts.forEach((d) => existing.departments.add(d));
            allTitles.forEach((t) => existing.topJobTitles.add(t));
            existing.jobs.push(...allJobs);
          } else {
            hiringDetailsByLead.set(leadId, {
              openJobCount: companyOpenRoles,
              departments: new Set(allDepts),
              topJobTitles: new Set(allTitles),
              jobs: [...allJobs],
            });
          }
        }
      }

      // ── Process Reddit results ──────────────────────────────────
      if (redditResults.length > 0) {
        const hasAnyMentions = redditResults.some((r) => r.totalMentions > 0 || r.totalActivities > 0);
        if (hasAnyMentions) companiesWithRedditSignals++;

        const companyMentions = redditResults.reduce((sum, r) => sum + r.totalMentions, 0);
        totalRedditMentions += companyMentions;

        const allSubreddits = new Set(redditResults.flatMap((r) => r.subredditsFound));
        const allPosts = redditResults.flatMap((r) => r.posts);

        for (const leadId of group.leadIds) {
          const existing = redditDetailsByLead.get(leadId);
          if (existing) {
            existing.totalMentions += companyMentions;
            allSubreddits.forEach((s) => existing.subredditsFound.add(s));
            existing.posts.push(...allPosts);
          } else {
            redditDetailsByLead.set(leadId, {
              totalMentions: companyMentions,
              subredditsFound: new Set(allSubreddits),
              posts: [...allPosts],
            });
          }
        }
      }

      // ── Persist hiring + Reddit in parallel ─────────────────────
      await Promise.all([
        hiringResults.length > 0
          ? this.persistHiringSignals(hiringResults, group.leadIds, ctx.pipelineRunId)
          : undefined,
        redditResults.length > 0
          ? this.persistRedditSignals(redditResults, group.leadIds, ctx.pipelineRunId)
          : undefined,
      ]);

      companiesChecked++;
      tools.emitProgress(
        `Checking signals — ${companiesChecked} of ${uniqueCompanies} companies`,
        { checked: companiesChecked, total: uniqueCompanies },
      );
    };

    await runWithConcurrency(
      Array.from(companyGroups.values()),
      COMPANY_CONCURRENCY,
      processCompany,
    );

    // ── 6. Summary ───────────────────────────────────────────────────
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

    const summaryMessage =
      parts.length > 0
        ? `Found ${parts.join("; ")}`
        : "No signals found";

    tools.emitProgress(summaryMessage, {
      checked: companiesChecked,
      withHiringSignals: companiesWithHiringSignals,
      withRedditSignals: companiesWithRedditSignals,
      openRoles: totalOpenRoles,
      redditMentions: totalRedditMentions,
    });

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        companiesChecked,
        companiesWithHiringSignals,
        companiesWithRedditSignals,
        totalOpenRoles,
        totalRedditMentions,
      },
      "Signals step completed",
    );

    // ── Build per-lead signal details for WS data ────────────────────
    const leadById = new Map(runLeads.map((rl) => [rl.lead.id, rl.lead]));

    const hiringDetails = buildHiringWsDetails(hiringDetailsByLead, leadById);
    const redditDetails = buildRedditWsDetails(redditDetailsByLead, leadById);

    return {
      outputSummary: {
        companiesChecked,
        companiesWithHiringSignals,
        companiesWithRedditSignals,
        totalOpenRoles,
        totalRedditMentions,
        leadsProcessed: runLeads.length,
      },
      data: {
        signals: {
          hiring: {
            leadsWithSignals: hiringDetailsByLead.size,
            totalOpenRoles,
            details: hiringDetails,
          },
          reddit: {
            leadsWithSignals: redditDetailsByLead.size,
            totalMentions: totalRedditMentions,
            details: redditDetails,
          },
        },
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Hiring signal helpers                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Queries all enabled hiring providers for a single company.
   * Provider errors are caught and logged; a failed provider never
   * prevents other providers from running.
   */
  private async fetchHiringSignals(
    group: CompanyGroup,
    providers: SignalProvider[],
    tools: PipelineTools,
  ): Promise<HiringSignalResult[]> {
    if (!group.companyName) return [];

    const results: HiringSignalResult[] = [];

    for (const provider of providers) {
      try {
        const result = await provider.detectHiringSignals({
          companyName: group.companyName,
          companyDomain: group.companyDomain,
          leadId: group.leadIds[0] ?? "",
        });

        if (result === null) {
          tools.log.info(
            { company: group.companyName },
            "Signals step: hiring provider limit reached, skipping",
          );
          continue;
        }

        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { company: group.companyName, err: msg },
          "Signals step: hiring provider error, skipping",
        );
      }
    }

    return results;
  }

  /**
   * Writes one `HiringSignal` row per (lead, provider) pair, including
   * nested `HiringSignalJob` and `HiringSignalJobLocation` records.
   */
  private async persistHiringSignals(
    results: HiringSignalResult[],
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<void> {
    if (results.length === 0 || leadIds.length === 0) return;

    const existing = await this.prisma.hiringSignal.findMany({
      where: {
        pipelineRunId,
        leadId: { in: leadIds },
        providerKey: { in: results.map((r) => r.providerKey) },
      },
      select: { leadId: true, providerKey: true },
    });

    const existingKeys = new Set(
      existing.map((e) => `${e.leadId}:${e.providerKey}`),
    );

    const creates = results.flatMap((result) =>
      leadIds
        .filter(
          (leadId) => !existingKeys.has(`${leadId}:${result.providerKey}`),
        )
        .map((leadId) =>
          this.prisma.hiringSignal.create({
            data: {
              lead: { connect: { id: leadId } },
              pipelineRunId,
              providerKey: result.providerKey,
              companyName: result.companyName,
              openJobCount: result.openJobCount,
              departments: result.departments,
              topJobTitles: result.topJobTitles,
              jobs: {
                create: result.jobs.map((job) => ({
                  externalId: job.externalId,
                  jobTitle: job.jobTitle,
                  team: job.team,
                  jobType: job.jobType,
                  locationType: job.locationType,
                  datePosted: job.datePosted,
                  companyName: job.companyName,
                  companySlug: job.companySlug,
                  requirementsSummary: job.requirementsSummary,
                  skills: job.skills,
                  technologies: job.technologies,
                  jobCategories: job.jobCategories,
                  locations: {
                    create: job.locations.map((loc) => ({
                      city: loc.city,
                      region: loc.region,
                      country: loc.country,
                    })),
                  },
                })),
              },
            },
          }),
        ),
    );

    if (creates.length > 0) {
      await this.prisma.$transaction(creates);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Reddit signal helpers                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Queries all enabled Reddit providers for a single company.
   * Provider errors are caught and logged; a failed provider never
   * prevents other providers from running.
   */
  private async fetchRedditSignals(
    group: CompanyGroup,
    providers: RedditSignalProvider[],
    subreddits: string[],
    tools: PipelineTools,
  ): Promise<RedditSignalResult[]> {
    if (!group.companyName) return [];

    const results: RedditSignalResult[] = [];

    for (const provider of providers) {
      try {
        const result = await provider.detectRedditSignals({
          companyName: group.companyName,
          companyDomain: group.companyDomain,
          leadId: group.leadIds[0] ?? "",
          subreddits,
        });

        if (result === null) {
          tools.log.info(
            { company: group.companyName },
            "Signals step: Reddit provider limit reached, skipping",
          );
          continue;
        }

        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { company: group.companyName, err: msg },
          "Signals step: Reddit provider error, skipping",
        );
      }
    }

    return results;
  }

  /**
   * Writes one `RedditSignal` row per (lead, provider) pair, including
   * nested `RedditSignalPost` records.
   */
  private async persistRedditSignals(
    results: RedditSignalResult[],
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<void> {
    if (results.length === 0 || leadIds.length === 0) return;

    const existing = await this.prisma.redditSignal.findMany({
      where: {
        pipelineRunId,
        leadId: { in: leadIds },
        providerKey: { in: results.map((r) => r.providerKey) },
      },
      select: { leadId: true, providerKey: true },
    });

    const existingKeys = new Set(
      existing.map((e: { leadId: string; providerKey: string }) => `${e.leadId}:${e.providerKey}`),
    );

    const creates = results.flatMap((result) =>
      leadIds
        .filter(
          (leadId) => !existingKeys.has(`${leadId}:${result.providerKey}`),
        )
        .map((leadId) =>
          this.prisma.redditSignal.create({
            data: {
              lead: { connect: { id: leadId } },
              pipelineRunId,
              providerKey: result.providerKey,
              companyName: result.companyName,
              totalMentions: result.totalMentions,
              totalActivities: result.totalActivities,
              subredditsFound: result.subredditsFound,
              posts: {
                create: result.posts.map((post) => ({
                  subreddit: post.subreddit,
                  postType: post.postType,
                  signalType: post.signalType,
                  title: post.title,
                  content: post.content,
                  author: post.author,
                  url: post.url,
                  score: post.score,
                  numComments: post.numComments,
                  createdUtc: post.createdUtc,
                })),
              },
            },
          }),
        ),
    );

    if (creates.length > 0) {
      await this.prisma.$transaction(creates);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                        */
/* ------------------------------------------------------------------ */

type RunLead = {
  lead: { id: string; fullName: string | null; company: string | null; companyDomain: string | null };
};

type LeadInfo = { id: string; fullName: string | null; company: string | null; companyDomain: string | null };

function buildCompanyGroups(runLeads: RunLead[]): Map<string, CompanyGroup> {
  const groups = new Map<string, CompanyGroup>();

  for (const rl of runLeads) {
    const rawName = rl.lead.company;
    if (!rawName) continue;

    const key = rawName.trim().toLowerCase();

    const existing = groups.get(key);
    if (existing) {
      existing.leadIds.push(rl.lead.id);
    } else {
      groups.set(key, {
        companyName: rawName.trim(),
        companyDomain: rl.lead.companyDomain,
        leadIds: [rl.lead.id],
      });
    }
  }

  return groups;
}

function pluralise(singular: string, plural: string, count: number): string {
  return count === 1 ? singular : plural;
}

/**
 * Executes `fn` for every item in `items`, running at most `concurrency`
 * invocations in parallel (worker-pool pattern).
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

function buildHiringWsDetails(
  detailsByLead: Map<string, { openJobCount: number; departments: Set<string>; topJobTitles: Set<string>; jobs: SignalJobDto[] }>,
  leadById: Map<string, LeadInfo>,
) {
  const details = Array.from(detailsByLead.entries()).map(([leadId, sig]) => {
    const lead = leadById.get(leadId);
    return {
      leadId,
      fullName: lead?.fullName ?? null,
      company: lead?.company ?? null,
      openJobCount: sig.openJobCount,
      departments: Array.from(sig.departments),
      topJobTitles: Array.from(sig.topJobTitles).slice(0, 10),
      jobs: sig.jobs.map((j) => ({
        externalId: j.externalId ?? null,
        jobTitle: j.jobTitle ?? null,
        team: j.team ?? null,
        jobType: j.jobType ?? null,
        locationType: j.locationType ?? null,
        datePosted: j.datePosted ?? null,
        companyName: j.companyName ?? null,
        companySlug: j.companySlug ?? null,
        requirementsSummary: j.requirementsSummary ?? null,
        skills: j.skills,
        technologies: j.technologies,
        jobCategories: j.jobCategories,
        locations: j.locations.map((l) => ({
          city: l.city ?? null,
          region: l.region ?? null,
          country: l.country ?? null,
        })),
      })),
    };
  });

  details.sort((a, b) => b.openJobCount - a.openJobCount);
  return details;
}

function buildRedditWsDetails(
  detailsByLead: Map<string, { totalMentions: number; subredditsFound: Set<string>; posts: RedditSignalPostDto[] }>,
  leadById: Map<string, LeadInfo>,
) {
  const details = Array.from(detailsByLead.entries()).map(([leadId, sig]) => {
    const lead = leadById.get(leadId);
    return {
      leadId,
      fullName: lead?.fullName ?? null,
      company: lead?.company ?? null,
      totalMentions: sig.totalMentions,
      subredditsFound: Array.from(sig.subredditsFound),
      posts: sig.posts.map((p) => ({
        subreddit: p.subreddit,
        postType: p.postType,
        signalType: p.signalType,
        title: p.title ?? null,
        content: p.content ?? null,
        author: p.author ?? null,
        url: p.url ?? null,
        score: p.score ?? null,
        numComments: p.numComments ?? null,
        createdUtc: p.createdUtc ?? null,
      })),
    };
  });

  details.sort((a, b) => b.totalMentions - a.totalMentions);
  return details;
}
