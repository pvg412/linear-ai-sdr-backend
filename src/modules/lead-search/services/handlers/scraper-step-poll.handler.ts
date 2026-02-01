// POLL step handler for scraper lead search

import { LeadProvider, LeadSearchStatus } from "@prisma/client";
import { msSince } from "@/infra/observability";
import type { ApifyScraperQuery, ScraperRunStatus } from "@/capabilities/scraper/scraper.dto";
import type { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import type { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import type { LeadSearchLeadPersisterService } from "@/modules/lead-search/services/lead-search.lead-persister.service";
import type { LeadSearchNotifierService } from "@/modules/lead-search/services/lead-search.notifier.service";

import {
  canComputeApifyResume,
  isApifyScrapeQuery,
  isRateLimitedStatus,
  USER_MESSAGES,
  type ScraperStepContext,
  type StepResult,
} from "./scraper-step.types";

export async function handlePollStep(
  ctx: ScraperStepContext,
  deps: {
    leadSearchRepository: LeadSearchRepository;
    leadSearchRunRepository: LeadSearchRunRepository;
    persister: LeadSearchLeadPersisterService;
    notifier: LeadSearchNotifierService;
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
    state,
    t0,
  } = ctx;

  const { leadSearchRepository, leadSearchRunRepository, persister, notifier } =
    deps;

  let runId = state.runId ?? null;
  let providerRunId = state.providerRunId ?? null;

  if (!providerRunId) {
    const existing = await leadSearchRunRepository.findLatestRunningRun(
      leadSearchId,
      provider,
    );
    if (existing?.externalRunId) {
      runId = existing.id;
      providerRunId = existing.externalRunId;
    }
  }

  if (!runId || !providerRunId) {
    lg.warn(
      { leadSearchId, provider, runId, providerRunId, state },
      "SCRAPER POLL: missing runId/providerRunId; resetting to INIT",
    );

    return {
      done: false,
      nextState: {
        ...state,
        step: "INIT",
        runId: null,
        providerRunId: null,
        pollAttempt: 0,
        lastStatus: null,
        initAtMs: state.initAtMs ?? Date.now(),
      },
      delayMs: 1_000,
    };
  }

  await leadSearchRunRepository.ensureExternalRunId(runId, providerRunId);

  const statusRes = await adapter.checkStatus(providerRunId);

  lg.info(
    {
      leadSearchId,
      provider,
      runId,
      providerRunId,
      pollAttempt: state.pollAttempt,
      status: statusRes.status,
    },
    "SCRAPER POLL",
  );

  if (statusRes.status === "RUNNING") {
    const nextAttempt = (state.pollAttempt ?? 0) + 1;

    if (nextAttempt >= adapter.maxPollAttempts) {
      const internalMsg = `SCRAPER polling timed out after ${adapter.maxPollAttempts} attempts (provider=${provider}, run=${providerRunId})`;
      await leadSearchRunRepository.markRunFailed(runId, internalMsg);
      await leadSearchRepository.markFailed(leadSearchId, USER_MESSAGES.final);

      await notifier.postEvent({
        threadId,
        leadSearchId,
        text: USER_MESSAGES.final,
        payload: {
          event: "leadSearch.failed",
          leadSearchId,
          status: LeadSearchStatus.FAILED,
          ...notifier.publicParserMeta(provider),
          kind,
          errorMessage: USER_MESSAGES.final,
          durationMs: msSince(t0),
        },
      });

      throw new Error(internalMsg);
    }

    return {
      done: false,
      nextState: {
        ...state,
        step: "POLL",
        runId,
        providerRunId,
        pollAttempt: nextAttempt,
        lastStatus: "RUNNING" as ScraperRunStatus,
      },
      delayMs: adapter.pollIntervalMs,
    };
  }

  if (statusRes.status === "FAILED") {
    // Special-case: Apify hourly rate limits. Resume on next hour boundary.
    if (
      provider === LeadProvider.APIFY &&
      isRateLimitedStatus(statusRes.raw) &&
      canComputeApifyResume(adapter) &&
      isApifyScrapeQuery(scrapeQuery)
    ) {
      const effectiveQuery: ApifyScraperQuery =
        state.apifyResume != null
          ? ({
            ...scrapeQuery,
            startPage: state.apifyResume.startPage,
            takePages: state.apifyResume.takePages,
          } satisfies ApifyScraperQuery)
          : scrapeQuery;

      const plan = await adapter.getRateLimitResumePlan({
        providerRunId,
        query: effectiveQuery,
        status: statusRes,
        now: new Date(),
      });

      // If there's nothing left to scrape, proceed to FETCH and finish the run.
      if (plan.remainingTakePages <= 0) {
        await job.updateData({
          ...job.data,
          scraper: {
            ...state,
            step: "FETCH",
            runId,
            providerRunId,
            lastStatus: "SUCCEEDED" as ScraperRunStatus,
          },
        });

        return {
          done: false,
          nextState: {
            ...state,
            step: "FETCH",
            runId,
            providerRunId,
            lastStatus: "SUCCEEDED" as ScraperRunStatus,
          },
          delayMs: 0, // fallthrough to FETCH in same tick
        };
      }

      // Persist partial dataset so we don't lose leads from earlier pages.
      const partialLeads = await adapter.fetchLeads({
        providerRunId,
        query: effectiveQuery,
        status: statusRes,
      });

      await persister.persistLeadsAndRelations({
        leadSearchId,
        runId,
        provider,
        leads: partialLeads,
        createdById: job.data.triggeredById ?? undefined,
        log: lg,
      });

      const nextRunAt = new Date(Date.now() + plan.waitMs).toISOString();
      const internalMsg =
        `SCRAPER rate limited (provider=${provider}, run=${providerRunId}); ` +
        `will resume at ${nextRunAt} (nextStartPage=${plan.nextStartPage}, remainingTakePages=${plan.remainingTakePages})`;

      // Mark current run as failed (it cannot be reused because externalRunId is immutable).
      await leadSearchRunRepository.markRunFailed(runId, internalMsg);

      // Keep LeadSearch RUNNING, schedule a new INIT on next hour.
      return {
        done: false,
        nextState: {
          ...state,
          step: "INIT",
          runId: null,
          providerRunId: null,
          pollAttempt: 0,
          lastStatus: "RUNNING" as ScraperRunStatus,
          initAtMs: Date.now(),
          apifyResume: {
            startPage: plan.nextStartPage,
            takePages: plan.remainingTakePages,
            plannedAtMs: Date.now(),
            fromProviderRunId: providerRunId,
          },
        },
        delayMs: plan.waitMs,
      };
    }

    const internalMsg = `SCRAPER provider failed (provider=${provider}, run=${providerRunId})`;
    await leadSearchRunRepository.markRunFailed(runId, internalMsg);
    await leadSearchRepository.markFailed(leadSearchId, USER_MESSAGES.final);

    await notifier.postEvent({
      threadId,
      leadSearchId,
      text: USER_MESSAGES.final,
      payload: {
        event: "leadSearch.failed",
        leadSearchId,
        status: LeadSearchStatus.FAILED,
        ...notifier.publicParserMeta(provider),
        kind,
        errorMessage: USER_MESSAGES.final,
        durationMs: msSince(t0),
      },
    });

    throw new Error(internalMsg);
  }

  // SUCCEEDED -> go FETCH (same tick)
  await job.updateData({
    ...job.data,
    scraper: {
      ...state,
      step: "FETCH",
      runId,
      providerRunId,
      lastStatus: "SUCCEEDED" as ScraperRunStatus,
    },
  });

  return {
    done: false,
    nextState: {
      ...state,
      step: "FETCH",
      runId,
      providerRunId,
      lastStatus: "SUCCEEDED" as ScraperRunStatus,
    },
    delayMs: 0, // fallthrough
  };
}
