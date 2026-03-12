// FETCH step handler for scraper lead search

import { LeadProvider, LeadSearchStatus, Prisma } from "@prisma/client";
import { msSince } from "@/infra/observability";
import type { ApifyScraperQuery } from "@/capabilities/scraper/scraper.dto";
import type { LeadSearchScraperJobState } from "@/infra/queue/lead-search/lead-search.queue";
import type { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import type { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import type { LeadSearchLeadPersisterService } from "@/modules/lead-search/services/lead-search.lead-persister.service";
import type { LeadSearchNotifierService } from "@/modules/lead-search/services/lead-search.notifier.service";
import type { BillingService } from "@/modules/balance/services/billing.service";

import {
  canComputeApifyResume,
  isApifyScrapeQuery,
  isRateLimitedStatus,
  type ScraperStepContext,
  type StepResult,
} from "./scraper-step.types";

export async function handleFetchStep(
  ctx: ScraperStepContext,
  deps: {
    leadSearchRepository: LeadSearchRepository;
    leadSearchRunRepository: LeadSearchRunRepository;
    persister: LeadSearchLeadPersisterService;
    notifier: LeadSearchNotifierService;
    billingService: BillingService;
  },
): Promise<StepResult> {
  const {
    job,
    log: lg,
    leadSearchId,
    threadId,
    provider,
    kind,
    adapter,
    scrapeQuery,
    t0,
  } = ctx;

  const { leadSearchRepository, leadSearchRunRepository, persister, notifier, billingService } =
    deps;

  const fetchState = job.data.scraper as LeadSearchScraperJobState;

  const runId = fetchState.runId ?? "";
  const providerRunId = fetchState.providerRunId ?? "";

  if (!runId || !providerRunId) {
    const msg = "SCRAPER FETCH: missing runId/providerRunId";
    await leadSearchRepository.markFailed(leadSearchId, msg);
    throw new Error(msg);
  }

  const effectiveQuery =
    provider === LeadProvider.APIFY &&
      fetchState.apifyResume &&
      isApifyScrapeQuery(scrapeQuery)
      ? ({
        ...scrapeQuery,
        startPage: fetchState.apifyResume.startPage,
        takePages: fetchState.apifyResume.takePages,
      } satisfies ApifyScraperQuery)
      : scrapeQuery;

  const statusRes = await adapter.checkStatus(providerRunId);
  if (statusRes.status !== "SUCCEEDED") {
    let allowPartialFetch = false;

    if (
      provider === LeadProvider.APIFY &&
      isRateLimitedStatus(statusRes.raw) &&
      canComputeApifyResume(adapter) &&
      isApifyScrapeQuery(effectiveQuery)
    ) {
      const plan = await adapter.getRateLimitResumePlan({
        providerRunId,
        query: effectiveQuery,
        status: statusRes,
        now: new Date(),
      });

      if (plan.remainingTakePages <= 0) {
        allowPartialFetch = true;
        lg.info(
          {
            leadSearchId,
            provider,
            providerRunId,
            datasetItemCount: plan.datasetItemCount,
            lastScrapedPage: plan.lastScrapedPage,
          },
          "SCRAPER FETCH: rate limited but dataset complete; proceeding",
        );
      }
    }

    if (!allowPartialFetch) {
      lg.debug(
        {
          leadSearchId,
          provider,
          runId,
          providerRunId,
          status: statusRes.status,
        },
        "SCRAPER FETCH: status is not SUCCEEDED, going back to POLL",
      );

      return {
        done: false,
        nextState: {
          ...fetchState,
          step: "POLL",
          lastStatus: statusRes.status,
        },
        delayMs: adapter.pollIntervalMs,
      };
    }
  }

  const leads = await adapter.fetchLeads({
    providerRunId,
    query: effectiveQuery,
    status: statusRes,
  });

  const insertedLeadIds = await persister.persistLeadsAndRelations({
    leadSearchId,
    runId,
    provider,
    leads,
    createdById: job.data.triggeredById ?? undefined,
    log: lg,
  });

  const total = await leadSearchRepository.countLeads(leadSearchId);

  await leadSearchRunRepository.markRunSuccess({
    runId,
    leadsCount: insertedLeadIds.length,
    externalRunId: providerRunId,
    responseMeta: { lastStatus: "SUCCEEDED" } as Prisma.InputJsonValue,
  });

  await leadSearchRepository.markDone(leadSearchId, total);

  // Billing: charge per lead after successful persistence.
  const triggeredByIdForBilling = job.data.triggeredById ?? null;
  if (triggeredByIdForBilling) {
    await billingService.chargeForLeadGeneration(triggeredByIdForBilling, total, lg);
  } else {
    lg.warn({ leadSearchId }, "ScraperStepFetchHandler: triggeredById is undefined, skipping billing");
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

  await notifier.postEvent({
    threadId,
    leadSearchId,
    text:
      doneStatus === LeadSearchStatus.DONE_NO_RESULTS
        ? "No leads found for these filters"
        : `Lead search completed. Found ${total} leads`,
    payload: {
      event: "leadSearch.completed",
      leadSearchId,
      status: doneStatus,
      ...notifier.publicParserMeta(provider),
      kind,
      totalLeads: total,
      shownLeads: shown,
      previewLimit,
      previewLeads,
      durationMs: msSince(t0),
    },
  });

  lg.info({ leadSearchId, provider, totalLeads: total }, "SCRAPER finished");

  return { done: true };
}
