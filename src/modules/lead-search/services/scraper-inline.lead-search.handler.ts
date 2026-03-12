import { inject, injectable } from "inversify";
import { LeadSearchKind, LeadSearchStatus, Prisma } from "@prisma/client";

import {
  ensureLogger,
  msSince,
  nowNs,
  type LoggerLike,
} from "@/infra/observability";
import { sleep } from "@/capabilities/shared/polling";

import { SCRAPER_TYPES } from "@/capabilities/scraper/scraper.types";
import { ScraperOrchestrator } from "@/capabilities/scraper/scraper.orchestrator";

import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import { LeadSearchLeadPersisterService } from "@/modules/lead-search/services/lead-search.lead-persister.service";
import { LeadSearchNotifierService } from "@/modules/lead-search/services/lead-search.notifier.service";
import { resolveScrapeQuery } from "@/modules/lead-search/services/scraper-query.resolver";
import { BALANCE_TYPES } from "@/modules/balance/balance.types";
import type { BillingService } from "@/modules/balance/services/billing.service";

@injectable()
export class ScraperInlineLeadSearchHandler {
  constructor(
    @inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
    private readonly leadSearchRepository: LeadSearchRepository,

    @inject(LEAD_SEARCH_TYPES.LeadSearchRunRepository)
    private readonly leadSearchRunRepository: LeadSearchRunRepository,

    @inject(SCRAPER_TYPES.ScraperOrchestrator)
    private readonly scraperOrchestrator: ScraperOrchestrator,

    @inject(LEAD_SEARCH_TYPES.LeadSearchLeadPersisterService)
    private readonly persister: LeadSearchLeadPersisterService,

    @inject(LEAD_SEARCH_TYPES.LeadSearchNotifierService)
    private readonly notifier: LeadSearchNotifierService,

    @inject(BALANCE_TYPES.BillingService)
    private readonly billingService: BillingService,
  ) {}

  async run(
    leadSearchId: string,
    triggeredById?: string,
    log?: LoggerLike,
  ): Promise<void> {
    const lg = ensureLogger(log);
    const t0 = nowNs();

    const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
    if (!leadSearch) throw new Error("LeadSearch not found");

    if (leadSearch.kind !== LeadSearchKind.SCRAPER) {
      throw new Error(
        `ScraperInlineLeadSearchHandler called for kind=${leadSearch.kind}`,
      );
    }

    const provider = leadSearch.provider;
    const kind = leadSearch.kind;

    const resolvedQuery = await resolveScrapeQuery({
      leadSearchId,
      leadSearchLimit: leadSearch.limit,
      storedQueryJson: leadSearch.query,
      provider,
      leadSearchRepository: this.leadSearchRepository,
    });

    if (!resolvedQuery.ok) {
      const msg = `Invalid LeadSearch.query schema for SCRAPER: ${JSON.stringify(
        resolvedQuery.issues,
      )}`;
      await this.leadSearchRepository.markFailed(leadSearchId, msg);

      await this.notifier.postEvent({
        threadId: leadSearch.threadId,
        leadSearchId,
        text: "Lead search failed: invalid JSON schema.",
        payload: {
          event: "leadSearch.failed",
          leadSearchId,
          status: LeadSearchStatus.FAILED,
          ...this.notifier.publicParserMeta(provider),
          kind,
          errorMessage: "Invalid JSON schema.",
          errorDetails: resolvedQuery.issues,
          durationMs: msSince(t0),
        },
      });

      throw new Error(msg);
    }

    const scrapeQuery = resolvedQuery.scrapeQuery;

    await this.leadSearchRepository.markRunning(leadSearchId);

    const resolvedAdapter = this.scraperOrchestrator.resolveAdapter(provider);
    if (!resolvedAdapter.ok) {
      const msg = `SCRAPER provider ${provider} is not available: ${resolvedAdapter.message}`;
      await this.leadSearchRepository.markFailed(leadSearchId, msg);
      throw new Error(msg);
    }

    const adapter = resolvedAdapter.adapter;

    // Reuse existing RUNNING run if any
    let run = await this.leadSearchRunRepository.findLatestRunningRun(
      leadSearchId,
      provider,
    );

    if (!run) {
      const attempt = await this.leadSearchRunRepository.getNextAttempt(
        leadSearchId,
        provider,
      );
      run = await this.leadSearchRunRepository.createRun({
        leadSearchId,
        provider,
        attempt,
        triggeredById: triggeredById ?? null,
        requestPayload: {
          limit: leadSearch.limit,
          query: scrapeQuery,
        } as Prisma.InputJsonValue,
      });
    }

    let providerRunId = run.externalRunId ?? null;

    if (!providerRunId) {
      const started = await adapter.start(scrapeQuery);
      providerRunId = started.providerRunId;
      await this.leadSearchRunRepository.ensureExternalRunId(
        run.id,
        providerRunId,
      );
    }

    for (
      let pollAttempt = 1;
      pollAttempt <= adapter.maxPollAttempts;
      pollAttempt++
    ) {
      const status = await adapter.checkStatus(providerRunId);

      lg.info(
        {
          leadSearchId,
          provider,
          providerRunId,
          pollAttempt,
          status: status.status,
        },
        "SCRAPER inline poll",
      );

      if (status.status === "FAILED") {
        const msg = `SCRAPER provider failed (provider=${provider}, run=${providerRunId})`;
        await this.leadSearchRunRepository.markRunFailed(run.id, msg);
        await this.leadSearchRepository.markFailed(leadSearchId, msg);
        throw new Error(msg);
      }

      if (status.status === "SUCCEEDED") {
        const leads = await adapter.fetchLeads({
          providerRunId,
          query: scrapeQuery,
          status,
        });

        const insertedLeadIds = await this.persister.persistLeadsAndRelations({
          leadSearchId,
          runId: run.id,
          provider,
          leads,
          createdById: triggeredById,
          log: lg,
        });

        await this.leadSearchRunRepository.markRunSuccess({
          runId: run.id,
          leadsCount: insertedLeadIds.length,
          externalRunId: providerRunId,
          responseMeta: { lastStatus: status.status } as Prisma.InputJsonValue,
        });

        await this.leadSearchRepository.markDone(
          leadSearchId,
          insertedLeadIds.length,
        );

        const total = insertedLeadIds.length;

        // Billing: charge per lead after successful persistence.
        if (triggeredById) {
          await this.billingService.chargeForLeadGeneration(triggeredById, total, lg);
        } else {
          lg.warn({ leadSearchId }, "ScraperInlineLeadSearchHandler: triggeredById is undefined, skipping billing");
        }

        const doneStatus =
          total > 0 ? LeadSearchStatus.DONE : LeadSearchStatus.DONE_NO_RESULTS;

        const shown = Math.min(total, 100);
        const previewLimit = 100;
        const previewLeads = leads.slice(0, shown).map((l, idx) => ({
          leadId: insertedLeadIds[idx] ?? null,
          fullName: l.fullName ?? null,
          title: l.title ?? null,
          company: l.company ?? null,
          email: l.email ?? null,
          linkedinUrl: l.linkedinUrl ?? null,
          companyDomain: l.companyDomain ?? null,
          location: l.location ?? null,
        }));

        await this.notifier.postEvent({
          threadId: leadSearch.threadId,
          leadSearchId,
          text:
            doneStatus === LeadSearchStatus.DONE_NO_RESULTS
              ? "No leads found for these filters"
              : `Lead search completed. Found ${total} leads`,
          payload: {
            event: "leadSearch.completed",
            leadSearchId,
            status: doneStatus,
            ...this.notifier.publicParserMeta(provider),
            kind,
            totalLeads: total,
            shownLeads: shown,
            previewLimit,
            previewLeads,
            durationMs: msSince(t0),
          },
        });

        return;
      }

      await sleep(adapter.pollIntervalMs);
    }

    const msg = `SCRAPER inline polling timed out after ${adapter.maxPollAttempts} attempts (provider=${provider}, run=${providerRunId})`;
    await this.leadSearchRunRepository.markRunFailed(run.id, msg);
    await this.leadSearchRepository.markFailed(leadSearchId, msg);
    throw new Error(msg);
  }
}
