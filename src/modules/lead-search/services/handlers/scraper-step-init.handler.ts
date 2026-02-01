// INIT step handler for scraper lead search

import { LeadProvider, LeadSearchStatus, Prisma } from "@prisma/client";
import { msSince } from "@/infra/observability";
import { SCRAPER_CONSTANTS } from "@/config/constants";
import type { ApifyScraperQuery, ScraperRunStatus } from "@/capabilities/scraper/scraper.dto";
import type { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import type { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import type { LeadSearchNotifierService } from "@/modules/lead-search/services/lead-search.notifier.service";

import {
  isApifyScrapeQuery,
  USER_MESSAGES,
  type ScraperStepContext,
  type StepResult,
} from "./scraper-step.types";

export async function handleInitStep(
  ctx: ScraperStepContext,
  deps: {
    leadSearchRepository: LeadSearchRepository;
    leadSearchRunRepository: LeadSearchRunRepository;
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
    jobAttemptsMade,
    jobMaxAttempts,
    isLastJobAttempt,
    leadSearchLimit,
  } = ctx;

  const { leadSearchRepository, leadSearchRunRepository, notifier } = deps;

  // If Redis state already has runId+providerRunId => reuse, never start again
  if (state.runId && state.providerRunId) {
    lg.debug(
      {
        leadSearchId,
        provider,
        runId: state.runId,
        providerRunId: state.providerRunId,
      },
      "SCRAPER INIT: reuse Redis state (runId+providerRunId already in job.data)",
    );

    await leadSearchRunRepository.ensureExternalRunId(
      state.runId,
      state.providerRunId,
    );

    return {
      done: false,
      nextState: { ...state, step: "POLL", lastStatus: "RUNNING" as ScraperRunStatus },
      delayMs: adapter.pollIntervalMs,
    };
  }

  // If DB has RUNNING with externalRunId => reuse
  const existing = await leadSearchRunRepository.findLatestRunningRun(
    leadSearchId,
    provider,
  );

  if (existing?.externalRunId) {
    lg.debug(
      {
        leadSearchId,
        provider,
        runId: existing.id,
        providerRunId: existing.externalRunId,
      },
      "SCRAPER INIT: reuse DB RUNNING LeadSearchRun.externalRunId",
    );

    return {
      done: false,
      nextState: {
        ...state,
        step: "POLL",
        runId: existing.id,
        providerRunId: existing.externalRunId,
        pollAttempt: state.pollAttempt ?? 0,
        lastStatus: "RUNNING" as ScraperRunStatus,
      },
      delayMs: adapter.pollIntervalMs,
    };
  }

  // RUNNING but missing externalRunId -> wait a bit, then fail that run
  if (existing && !existing.externalRunId) {
    const ageMs = Date.now() - existing.updatedAt.getTime();

    if (ageMs <= SCRAPER_CONSTANTS.EXTERNAL_RUN_ID_GRACE_MS) {
      lg.debug(
        {
          leadSearchId,
          provider,
          runId: existing.id,
          ageMs,
          graceMs: SCRAPER_CONSTANTS.EXTERNAL_RUN_ID_GRACE_MS,
        },
        "SCRAPER INIT: waiting for externalRunId (grace period)",
      );

      return {
        done: false,
        nextState: {
          ...state,
          step: "INIT",
          runId: existing.id,
          providerRunId: null,
          lastStatus: "STARTING" as ScraperRunStatus,
          initAtMs: state.initAtMs ?? Date.now(),
        },
        delayMs: SCRAPER_CONSTANTS.EXTERNAL_RUN_ID_RETRY_DELAY_MS,
      };
    }

    lg.warn(
      {
        leadSearchId,
        provider,
        runId: existing.id,
        ageMs,
      },
      "SCRAPER INIT: stale RUNNING LeadSearchRun without externalRunId; marking failed and starting new attempt",
    );

    await leadSearchRunRepository.markRunFailed(
      existing.id,
      "RUNNING LeadSearchRun has no externalRunId after grace period; assuming broken start",
    );
  }

  // Create new attempt
  const attempt = await leadSearchRunRepository.getNextAttempt(
    leadSearchId,
    provider,
  );

  const run = await leadSearchRunRepository.createRun({
    leadSearchId,
    provider,
    attempt,
    triggeredById: job.data.triggeredById ?? null,
    requestPayload: {
      limit: leadSearchLimit,
      query: scrapeQuery,
    } as Prisma.InputJsonValue,
  });

  lg.info(
    {
      leadSearchId,
      provider,
      attempt,
      pollIntervalMs: adapter.pollIntervalMs,
      maxPollAttempts: adapter.maxPollAttempts,
    },
    "SCRAPER INIT: starting provider run",
  );

  let started: Awaited<ReturnType<typeof adapter.start>>;
  try {
    // If we have an Apify resume plan (rate limit), apply it for the next run.
    const effectiveQuery =
      provider === LeadProvider.APIFY &&
        state.apifyResume &&
        isApifyScrapeQuery(scrapeQuery)
        ? ({
          ...scrapeQuery,
          startPage: state.apifyResume.startPage,
          takePages: state.apifyResume.takePages,
        } satisfies ApifyScraperQuery)
        : scrapeQuery;

    started = await adapter.start(effectiveQuery);
  } catch (err) {
    const internalMsg = err instanceof Error ? err.message : String(err);

    // IMPORTANT: mark run failed immediately to avoid "RUNNING without externalRunId" grace loops
    await leadSearchRunRepository
      .markRunFailed(run.id, `SCRAPER start failed: ${internalMsg}`)
      .catch(() => { });

    // If this is the last queue attempt, finish LeadSearch and notify user
    if (isLastJobAttempt) {
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
          retries: {
            attemptsMade: jobAttemptsMade + 1,
            maxAttempts: jobMaxAttempts,
          },
        },
      });
    } else {
      // Optional: a single informative message (no provider mention) on retryable failures
      await notifier.postEvent({
        threadId,
        leadSearchId,
        text: USER_MESSAGES.retryable,
        payload: {
          event: "leadSearch.retrying",
          leadSearchId,
          status: LeadSearchStatus.RUNNING,
          ...notifier.publicParserMeta(provider),
          kind,
          message: USER_MESSAGES.retryable,
          retries: {
            attemptsMade: jobAttemptsMade + 1,
            maxAttempts: jobMaxAttempts,
          },
        },
      });
    }

    throw err;
  }

  // Persist runId/providerRunId into Redis job data FIRST
  const nextState = {
    ...state,
    step: "POLL" as const,
    runId: run.id,
    providerRunId: started.providerRunId,
    pollAttempt: 0,
    lastStatus: "RUNNING" as ScraperRunStatus,
    initAtMs: state.initAtMs ?? Date.now(),
  };

  await job.updateData({
    ...job.data,
    scraper: nextState,
  });

  // Then persist into Postgres
  await leadSearchRunRepository.ensureExternalRunId(
    run.id,
    started.providerRunId,
  );

  // Signal that job data was already updated, just need delay
  return {
    done: false,
    nextState,
    delayMs: adapter.pollIntervalMs,
  };
}
