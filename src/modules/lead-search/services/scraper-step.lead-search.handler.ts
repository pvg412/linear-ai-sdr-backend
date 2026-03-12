import { inject, injectable } from "inversify";
import { DelayedError, type Job } from "bullmq";
import { LeadSearchKind, LeadSearchStatus } from "@prisma/client";

import {
  ensureLogger,
  msSince,
  nowNs,
  type LoggerLike,
} from "@/infra/observability";
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

import type {
  LeadSearchJobData,
  LeadSearchJobName,
} from "@/infra/queue/lead-search/lead-search.queue";

import {
  handleInitStep,
  handlePollStep,
  handleFetchStep,
  USER_MESSAGES,
  type ScraperState,
  type ScraperStepContext,
} from "./handlers";

@injectable()
export class ScraperStepLeadSearchHandler {
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
  ) { }

  async process(
    job: Job<LeadSearchJobData, void, LeadSearchJobName>,
    token: string,
    log?: LoggerLike,
  ): Promise<void> {
    const lg = ensureLogger(log);
    const t0 = nowNs();

    const leadSearchId = job.data.leadSearchId;

    const jobAttemptsMade = job.attemptsMade ?? 0;
    const jobMaxAttempts =
      typeof job.opts.attempts === "number" ? job.opts.attempts : null;
    const isLastJobAttempt =
      jobMaxAttempts !== null ? jobAttemptsMade + 1 >= jobMaxAttempts : false;

    const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
    if (!leadSearch) throw new Error("LeadSearch not found");

    if (leadSearch.kind !== LeadSearchKind.SCRAPER) {
      throw new Error(
        `ScraperStepLeadSearchHandler called for kind=${leadSearch.kind}`,
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

    const state: ScraperState = job.data.scraper ?? {
      step: "INIT",
      providerIndex: 0,
      providersOrder: [provider],
      pollAttempt: 0,
      runId: null,
      providerRunId: null,
      lastStatus: null,
      initAtMs: Date.now(),
      apifyResume: null,
    };

    const ctx: ScraperStepContext = {
      job,
      token,
      log: lg,
      leadSearchId,
      threadId: leadSearch.threadId,
      provider,
      kind,
      adapter,
      scrapeQuery,
      state,
      t0,
      jobAttemptsMade,
      jobMaxAttempts,
      isLastJobAttempt,
      triggeredById: job.data.triggeredById ?? null,
      leadSearchLimit: leadSearch.limit,
    };

    const deps = {
      leadSearchRepository: this.leadSearchRepository,
      leadSearchRunRepository: this.leadSearchRunRepository,
      persister: this.persister,
      notifier: this.notifier,
      billingService: this.billingService,
    };

    try {
      // Execute steps in a loop to handle fallthrough (e.g., POLL -> FETCH)
      let currentState = state;
      let iterations = 0;
      const maxIterations = 3; // Prevent infinite loops

      while (iterations < maxIterations) {
        iterations++;

        const stepCtx = { ...ctx, state: currentState };
        let result;

        if (currentState.step === "INIT") {
          result = await handleInitStep(stepCtx, deps);
        } else if (currentState.step === "POLL") {
          result = await handlePollStep(stepCtx, deps);
        } else if (currentState.step === "FETCH") {
          result = await handleFetchStep(stepCtx, deps);
        } else {
          lg.warn(
            { leadSearchId, state: currentState },
            "SCRAPER step-job: no matching step",
          );
          return;
        }

        if (result.done) {
          return;
        }

        if (result.nextState && result.delayMs !== undefined) {
          if (result.delayMs > 0) {
            // Need to delay - exit the loop
            await this.delayJob(
              job,
              token,
              result.delayMs,
              { ...job.data, scraper: result.nextState },
              lg,
            );
            return;
          }
          // delayMs === 0 means fallthrough to next step
          currentState = result.nextState;
        } else {
          return;
        }
      }

      lg.warn(
        { leadSearchId, iterations },
        "SCRAPER step-job: max iterations reached",
      );
    } catch (err) {
      // Do not intercept BullMQ control flow
      if (err instanceof DelayedError) throw err;

      // If this is the last queue attempt and we didn't already fail + notify, do it here.
      if (isLastJobAttempt) {
        const runIdFromState = job.data.scraper?.runId ?? null;
        const internalMsg = err instanceof Error ? err.message : String(err);

        if (runIdFromState) {
          await this.leadSearchRunRepository
            .markRunFailed(runIdFromState, internalMsg)
            .catch(() => { });
        }

        await this.leadSearchRepository.markFailed(
          leadSearchId,
          USER_MESSAGES.final,
        );

        await this.notifier.postEvent({
          threadId: leadSearch.threadId,
          leadSearchId,
          text: USER_MESSAGES.final,
          payload: {
            event: "leadSearch.failed",
            leadSearchId,
            status: LeadSearchStatus.FAILED,
            ...this.notifier.publicParserMeta(provider),
            kind,
            errorMessage: USER_MESSAGES.final,
            durationMs: msSince(t0),
            retries: {
              attemptsMade: jobAttemptsMade + 1,
              maxAttempts: jobMaxAttempts,
            },
          },
        });
      }

      throw err;
    }
  }

  private async delayJob(
    job: Job<LeadSearchJobData, void, LeadSearchJobName>,
    token: string,
    delayMs: number,
    nextData: LeadSearchJobData,
    lg: ReturnType<typeof ensureLogger>,
  ): Promise<never> {
    const nextRunAt = Date.now() + delayMs;

    lg.debug(
      {
        leadSearchId: job.data.leadSearchId,
        jobId: job.id,
        fromStep: job.data.scraper?.step ?? null,
        toStep: nextData.scraper?.step ?? null,
        delayMs,
        nextRunAt: new Date(nextRunAt).toISOString(),
      },
      "SCRAPER scheduled next tick (moveToDelayed)",
    );

    await job.updateData(nextData);
    await job.moveToDelayed(nextRunAt, token);
    throw new DelayedError();
  }
}
