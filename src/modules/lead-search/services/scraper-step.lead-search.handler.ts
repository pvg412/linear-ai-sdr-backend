import { inject, injectable } from "inversify";
import { DelayedError, type Job } from "bullmq";
import { LeadSearchKind, LeadSearchStatus, Prisma } from "@prisma/client";

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

import type {
	LeadSearchJobData,
	LeadSearchJobName,
} from "@/infra/queue/lead-search.queue";

// Protects from crash window start() -> persist externalRunId
const EXTERNAL_RUN_ID_GRACE_MS = 2 * 60 * 1000;
const EXTERNAL_RUN_ID_RETRY_DELAY_MS = 15 * 1000;

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
		private readonly notifier: LeadSearchNotifierService
	) {}

	async process(
		job: Job<LeadSearchJobData, void, LeadSearchJobName>,
		token: string,
		log?: LoggerLike
	): Promise<void> {
		const lg = ensureLogger(log);
		const t0 = nowNs();

		const leadSearchId = job.data.leadSearchId;

		const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
		if (!leadSearch) throw new Error("LeadSearch not found");

		if (leadSearch.kind !== LeadSearchKind.SCRAPER) {
			throw new Error(
				`ScraperStepLeadSearchHandler called for kind=${leadSearch.kind}`
			);
		}

		const provider = leadSearch.provider;
		const kind = leadSearch.kind;

		const resolvedQuery = await resolveScrapeQuery({
			leadSearchId,
			leadSearchLimit: leadSearch.limit,
			storedQueryJson: leadSearch.query,
			leadSearchRepository: this.leadSearchRepository,
		});

		if (!resolvedQuery.ok) {
			const msg = `Invalid LeadSearch.query schema for SCRAPER: ${JSON.stringify(
				resolvedQuery.issues
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

		const state = job.data.scraper ?? {
			step: "INIT" as const,
			providerIndex: 0,
			providersOrder: [provider],
			pollAttempt: 0,
			runId: null,
			providerRunId: null,
			lastStatus: null,
			initAtMs: Date.now(),
		};

		// -------------------------
		// INIT
		// -------------------------
		if (state.step === "INIT") {
			// If Redis state already has runId+providerRunId => reuse, never start again
			if (state.runId && state.providerRunId) {
				await this.leadSearchRunRepository.ensureExternalRunId(
					state.runId,
					state.providerRunId
				);

				const nextData: LeadSearchJobData = {
					...job.data,
					scraper: { ...state, step: "POLL", lastStatus: "RUNNING" },
				};

				await this.delayJob(job, token, adapter.pollIntervalMs, nextData);
				return;
			}

			// If DB has RUNNING with externalRunId => reuse
			const existing = await this.leadSearchRunRepository.findLatestRunningRun(
				leadSearchId,
				provider
			);

			if (existing?.externalRunId) {
				const nextData: LeadSearchJobData = {
					...job.data,
					scraper: {
						...state,
						step: "POLL",
						runId: existing.id,
						providerRunId: existing.externalRunId,
						pollAttempt: state.pollAttempt ?? 0,
						lastStatus: "RUNNING",
					},
				};
				await this.delayJob(job, token, adapter.pollIntervalMs, nextData);
				return;
			}

			// RUNNING but missing externalRunId -> wait a bit, then fail that run
			if (existing && !existing.externalRunId) {
				const ageMs = Date.now() - existing.updatedAt.getTime();

				if (ageMs <= EXTERNAL_RUN_ID_GRACE_MS) {
					const nextData: LeadSearchJobData = {
						...job.data,
						scraper: {
							...state,
							step: "INIT",
							runId: existing.id,
							providerRunId: null,
							lastStatus: "STARTING",
							initAtMs: state.initAtMs ?? Date.now(),
						},
					};
					await this.delayJob(
						job,
						token,
						EXTERNAL_RUN_ID_RETRY_DELAY_MS,
						nextData
					);
					return;
				}

				await this.leadSearchRunRepository.markRunFailed(
					existing.id,
					"RUNNING LeadSearchRun has no externalRunId after grace period; assuming broken start"
				);
			}

			// Create new attempt
			const attempt = await this.leadSearchRunRepository.getNextAttempt(
				leadSearchId,
				provider
			);

			const run = await this.leadSearchRunRepository.createRun({
				leadSearchId,
				provider,
				attempt,
				triggeredById: job.data.triggeredById ?? null,
				requestPayload: {
					limit: leadSearch.limit,
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
				"SCRAPER INIT: starting provider run"
			);

			const started = await adapter.start(scrapeQuery);

			// Persist runId/providerRunId into Redis job data FIRST
			const nextData: LeadSearchJobData = {
				...job.data,
				scraper: {
					...state,
					step: "POLL",
					runId: run.id,
					providerRunId: started.providerRunId,
					pollAttempt: 0,
					lastStatus: "RUNNING",
					initAtMs: state.initAtMs ?? Date.now(),
				},
			};

			await job.updateData(nextData);

			// Then persist into Postgres
			await this.leadSearchRunRepository.ensureExternalRunId(
				run.id,
				started.providerRunId
			);

			// Delay next poll tick
			await this.delayAfterUpdate(job, token, adapter.pollIntervalMs);
			return;
		}

		// -------------------------
		// POLL
		// -------------------------
		if (state.step === "POLL") {
			let runId = state.runId ?? null;
			let providerRunId = state.providerRunId ?? null;

			if (!providerRunId) {
				const existing =
					await this.leadSearchRunRepository.findLatestRunningRun(
						leadSearchId,
						provider
					);
				if (existing?.externalRunId) {
					runId = existing.id;
					providerRunId = existing.externalRunId;
				}
			}

			if (!runId || !providerRunId) {
				const nextData: LeadSearchJobData = {
					...job.data,
					scraper: {
						...state,
						step: "INIT",
						runId: null,
						providerRunId: null,
						pollAttempt: 0,
						lastStatus: null,
					},
				};
				await job.updateData(nextData);
				return;
			}

			await this.leadSearchRunRepository.ensureExternalRunId(
				runId,
				providerRunId
			);

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
				"SCRAPER POLL"
			);

			if (statusRes.status === "RUNNING") {
				const nextAttempt = (state.pollAttempt ?? 0) + 1;

				if (nextAttempt >= adapter.maxPollAttempts) {
					const msg = `SCRAPER polling timed out after ${adapter.maxPollAttempts} attempts (provider=${provider}, run=${providerRunId})`;
					await this.leadSearchRunRepository.markRunFailed(runId, msg);
					await this.leadSearchRepository.markFailed(leadSearchId, msg);

					await this.notifier.postEvent({
						threadId: leadSearch.threadId,
						leadSearchId,
						text: "Lead search failed.",
						payload: {
							event: "leadSearch.failed",
							leadSearchId,
							status: LeadSearchStatus.FAILED,
							...this.notifier.publicParserMeta(provider),
							kind,
							errorMessage: msg,
							durationMs: msSince(t0),
						},
					});

					throw new Error(msg);
				}

				const nextData: LeadSearchJobData = {
					...job.data,
					scraper: {
						...state,
						step: "POLL",
						runId,
						providerRunId,
						pollAttempt: nextAttempt,
						lastStatus: "RUNNING",
					},
				};
				await this.delayJob(job, token, adapter.pollIntervalMs, nextData);
				return;
			}

			if (statusRes.status === "FAILED") {
				const msg = `SCRAPER provider failed (provider=${provider}, run=${providerRunId})`;
				await this.leadSearchRunRepository.markRunFailed(runId, msg);
				await this.leadSearchRepository.markFailed(leadSearchId, msg);

				await this.notifier.postEvent({
					threadId: leadSearch.threadId,
					leadSearchId,
					text: "Lead search failed.",
					payload: {
						event: "leadSearch.failed",
						leadSearchId,
						status: LeadSearchStatus.FAILED,
						...this.notifier.publicParserMeta(provider),
						kind,
						errorMessage: msg,
						durationMs: msSince(t0),
					},
				});

				throw new Error(msg);
			}

			// SUCCEEDED -> go FETCH (same tick)
			await job.updateData({
				...job.data,
				scraper: {
					...state,
					step: "FETCH",
					runId,
					providerRunId,
					lastStatus: "SUCCEEDED",
				},
			});
			// fallthrough
		}

		// -------------------------
		// FETCH
		// -------------------------
		if (job.data.scraper?.step === "FETCH") {
			const fetchState = job.data.scraper;

			const runId = fetchState.runId ?? "";
			const providerRunId = fetchState.providerRunId ?? "";

			if (!runId || !providerRunId) {
				const msg = "SCRAPER FETCH: missing runId/providerRunId";
				await this.leadSearchRepository.markFailed(leadSearchId, msg);
				throw new Error(msg);
			}

			const statusRes = await adapter.checkStatus(providerRunId);
			if (statusRes.status !== "SUCCEEDED") {
				await this.delayJob(job, token, adapter.pollIntervalMs, {
					...job.data,
					scraper: {
						...fetchState,
						step: "POLL",
						lastStatus: statusRes.status,
					},
				});
				return;
			}

			const leads = await adapter.fetchLeads({
				providerRunId,
				query: scrapeQuery,
				status: statusRes,
			});

			const insertedLeadIds = await this.persister.persistLeadsAndRelations({
				leadSearchId,
				runId,
				provider,
				leads,
				createdById: job.data.triggeredById ?? undefined,
				log: lg,
			});

			await this.leadSearchRunRepository.markRunSuccess({
				runId,
				leadsCount: insertedLeadIds.length,
				externalRunId: providerRunId,
				responseMeta: { lastStatus: "SUCCEEDED" } as Prisma.InputJsonValue,
			});

			await this.leadSearchRepository.markDone(
				leadSearchId,
				insertedLeadIds.length
			);

			const total = insertedLeadIds.length;
			const doneStatus =
				total > 0 ? LeadSearchStatus.DONE : LeadSearchStatus.DONE_NO_RESULTS;

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
					durationMs: msSince(t0),
				},
			});

			lg.info(
				{ leadSearchId, provider, totalLeads: total },
				"SCRAPER finished"
			);
			return;
		}

		lg.warn(
			{ leadSearchId, state: job.data.scraper },
			"SCRAPER step-job: no matching step"
		);
	}

	private async delayJob(
		job: Job<LeadSearchJobData, void, LeadSearchJobName>,
		token: string,
		delayMs: number,
		nextData: LeadSearchJobData
	): Promise<never> {
		await job.updateData(nextData);
		await job.moveToDelayed(Date.now() + delayMs, token);
		throw new DelayedError();
	}

	private async delayAfterUpdate(
		job: Job<LeadSearchJobData, void, LeadSearchJobName>,
		token: string,
		delayMs: number
	): Promise<never> {
		await job.moveToDelayed(Date.now() + delayMs, token);
		throw new DelayedError();
	}
}
