import { injectable, multiInject, optional } from "inversify";
import type { PrismaClient, Prisma } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { HIRING_SIGNAL_TYPES } from "@/capabilities/hiring-signals/hiring-signals.types";
import type {
  SignalProvider,
  HiringSignalResult,
} from "@/capabilities/hiring-signals/signal-provider.dto";

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
 * Signals step — hiring signal detection.
 *
 * For each unique company represented in the active pipeline leads,
 * queries each configured signal provider for open job listings.
 * Results are stored in `HiringSignal` for downstream use (e.g.
 * final-scoring can load them to compute a signal-strength score).
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
    private readonly providers: SignalProvider[],
  ) {
    // @optional() allows the step to function even if no providers are
    // registered (e.g. in tests or when all API keys are absent).
    this.providers = providers ?? [];
  }

  async run(
    ctx: PipelineContext,
    _config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const enabledProviders = this.providers.filter((p) => p.isEnabled());

    // ── 1. Skip fast if no providers are configured ──────────────────
    if (enabledProviders.length === 0) {
      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId },
        "Signals step: no providers configured, skipping",
      );
      tools.emitProgress("Hiring signal check skipped — no providers configured");
      return {
        outputSummary: { skipped: true, reason: "no_providers" },
      };
    }

    // ── 2. Load active leads ─────────────────────────────────────────
    const runLeads = await this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId: ctx.pipelineRunId, excluded: false },
      include: { lead: { select: { id: true, company: true, companyDomain: true } } },
      orderBy: { createdAt: "asc" },
    });

    if (runLeads.length === 0) {
      tools.emitProgress("No leads to check for hiring signals");
      return {
        outputSummary: { companiesChecked: 0, signalsFound: 0, totalOpenRoles: 0 },
      };
    }

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, leadCount: runLeads.length },
      "Signals step: loaded active leads",
    );

    // ── 3. Deduplicate by company name ───────────────────────────────
    const companyGroups = buildCompanyGroups(runLeads);
    const uniqueCompanies = companyGroups.size;

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, uniqueCompanies },
      "Signals step: unique companies to check",
    );

    tools.emitProgress("Checking hiring signals...", {
      companies: uniqueCompanies,
    });

    // ── 4. Per-company signal lookup ─────────────────────────────────
    let companiesChecked = 0;
    let companiesWithSignals = 0;
    let totalOpenRoles = 0;

    for (const group of companyGroups.values()) {
      if (await tools.checkCancelled()) {
        tools.log.info(
          { pipelineRunId: ctx.pipelineRunId },
          "Signals step: cancelled during company loop",
        );
        break;
      }

      const companyResults = await this.fetchSignalsForCompany(
        group,
        enabledProviders,
        tools,
      );

      if (companyResults.length > 0) {
        companiesWithSignals++;
        totalOpenRoles += companyResults.reduce(
          (sum, r) => sum + r.openJobCount,
          0,
        );

        await this.persistSignals(
          companyResults,
          group.leadIds,
          ctx.pipelineRunId,
        );
      }

      companiesChecked++;

      tools.emitProgress(
        `Checking hiring signals — ${companiesChecked} of ${uniqueCompanies} companies`,
        { checked: companiesChecked, total: uniqueCompanies },
      );
    }

    // ── 5. Summary ───────────────────────────────────────────────────
    const summaryMessage =
      companiesWithSignals > 0
        ? `Found ${companiesWithSignals} ${pluralise("company", "companies", companiesWithSignals)} with active hiring (${totalOpenRoles} open ${pluralise("role", "roles", totalOpenRoles)})`
        : "No active hiring signals found";

    tools.emitProgress(summaryMessage, {
      checked: companiesChecked,
      withSignals: companiesWithSignals,
      openRoles: totalOpenRoles,
    });

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        companiesChecked,
        companiesWithSignals,
        totalOpenRoles,
      },
      "Signals step completed",
    );

    return {
      outputSummary: {
        companiesChecked,
        companiesWithSignals,
        totalOpenRoles,
        leadsProcessed: runLeads.length,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Queries all enabled providers for a single company.
   * Provider errors are caught and logged; a failed provider never
   * prevents other providers from running.
   */
  private async fetchSignalsForCompany(
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
          // Rate limit reached — logged inside the provider; skip silently.
          tools.log.info(
            { company: group.companyName },
            "Signals step: provider limit reached, skipping remaining calls for this provider",
          );
          // Don't break the outer loop — another provider might still work.
          continue;
        }

        results.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        tools.log.warn(
          { company: group.companyName, err: msg },
          "Signals step: provider error, skipping",
        );
      }
    }

    return results;
  }

  /**
   * Writes one `HiringSignal` row per (lead, provider) pair.
   * `skipDuplicates` prevents errors if the step is retried.
   */
  private async persistSignals(
    results: HiringSignalResult[],
    leadIds: string[],
    pipelineRunId: string,
  ): Promise<void> {
    if (results.length === 0 || leadIds.length === 0) return;

    const rows = results.flatMap((result) =>
      leadIds.map((leadId) => ({
        leadId,
        pipelineRunId,
        providerKey: result.providerKey,
        companyName: result.companyName,
        openJobCount: result.openJobCount,
        departments: result.departments,
        topJobTitles: result.topJobTitles,
        rawData: result.rawData as Prisma.InputJsonValue,
      })),
    );

    await this.prisma.hiringSignal.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                        */
/* ------------------------------------------------------------------ */

type RunLead = {
  lead: { id: string; company: string | null; companyDomain: string | null };
};

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
