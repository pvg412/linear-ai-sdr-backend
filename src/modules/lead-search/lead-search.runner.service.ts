import { inject, injectable, optional } from "inversify";
import { Queue, type Job } from "bullmq";
import { LeadSearchKind, LeadSearchStatus } from "@prisma/client";

import { ensureLogger, type LoggerLike } from "@/infra/observability";

import { LEAD_SEARCH_TYPES } from "./lead-search.types";
import { LeadSearchRepository } from "./persistence/lead-search.repository";

import { QUEUE_TYPES } from "@/infra/queue/queue.types";
import {
	type LeadSearchJobData,
	type LeadSearchJobName,
	leadSearchJobOptions,
} from "@/infra/queue/lead-search.queue";

import { LeadDbLeadSearchHandler } from "@/modules/lead-search/services/lead-db.lead-search.handler";
import { ScraperInlineLeadSearchHandler } from "@/modules/lead-search/services/scraper-inline.lead-search.handler";
import { ScraperStepLeadSearchHandler } from "@/modules/lead-search/services/scraper-step.lead-search.handler";

@injectable()
export class LeadSearchRunnerService {
	constructor(
		@inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
		private readonly leadSearchRepository: LeadSearchRepository,

		@inject(LEAD_SEARCH_TYPES.LeadDbLeadSearchHandler)
		private readonly leadDbHandler: LeadDbLeadSearchHandler,

		@inject(LEAD_SEARCH_TYPES.ScraperInlineLeadSearchHandler)
		private readonly scraperInlineHandler: ScraperInlineLeadSearchHandler,

		@inject(LEAD_SEARCH_TYPES.ScraperStepLeadSearchHandler)
		private readonly scraperStepHandler: ScraperStepLeadSearchHandler,

		@inject(QUEUE_TYPES.LeadSearchQueue)
		@optional()
		private readonly leadSearchQueue?: Queue<
			LeadSearchJobData,
			void,
			LeadSearchJobName
		>
	) {}

	private isProd(): boolean {
		return process.env.NODE_ENV === "production";
	}

	dispatch(
		leadSearchId: string,
		triggeredById?: string,
		log?: LoggerLike
	): void {
		const lg = ensureLogger(log);
		const q = this.leadSearchQueue;

		// No queue configured (dev/local) -> inline
		if (!q) {
			setImmediate(() => {
				void this.runInline(leadSearchId, triggeredById, lg).catch((err) => {
					lg.error(
						{ err: err as Error, leadSearchId },
						"LeadSearch inline failed"
					);
				});
			});
			return;
		}

		void (async () => {
			try {
				await q.add(
					"leadSearch.run",
					{ leadSearchId, triggeredById: triggeredById ?? null },
					{ jobId: leadSearchId, ...leadSearchJobOptions() }
				);

				lg.info({ leadSearchId }, "LeadSearch job enqueued");
				return;
			} catch (err) {
				// If job already exists -> idempotent no-op
				const existing = await q.getJob(leadSearchId).catch(() => null);
				if (existing) {
					lg.info(
						{
							leadSearchId,
							state: await existing.getState().catch(() => null),
						},
						"LeadSearch job already exists; skipping enqueue"
					);
					return;
				}

				// Queue is likely down / connection issue. Decide whether inline fallback is safe.
				const leadSearch = await this.leadSearchRepository
					.getById(leadSearchId)
					.catch(() => null);

				const kind = leadSearch?.kind;
				const isProd = this.isProd();

				lg.error(
					{ err: err as Error, leadSearchId, kind },
					"Failed to enqueue LeadSearch job"
				);

				// Production safety:
				// - allow inline ONLY for LEAD_DB (fast, no long polling)
				// - if kind is unknown -> do NOT run inline
				if (isProd) {
					if (kind !== LeadSearchKind.LEAD_DB) return;
				}

				// Dev-ish fallback (or prod LEAD_DB with known kind)
				setImmediate(() => {
					void this.runInline(leadSearchId, triggeredById, lg).catch((e) => {
						lg.error(
							{ err: e as Error, leadSearchId },
							"LeadSearch inline fallback failed"
						);
					});
				});
			}
		})();
	}

	/**
	 * Worker entrypoint.
	 */
	async processQueueJob(
		job: Job<LeadSearchJobData, void, LeadSearchJobName>,
		token: string | undefined,
		log?: LoggerLike
	): Promise<void> {
		const lg = ensureLogger(log);
		const leadSearchId = job.data.leadSearchId;

		const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
		if (!leadSearch) throw new Error("LeadSearch not found");

		// Hard idempotency: finished => no-op
		if (
			leadSearch.status === LeadSearchStatus.DONE ||
			leadSearch.status === LeadSearchStatus.DONE_NO_RESULTS ||
			leadSearch.status === LeadSearchStatus.FAILED
		) {
			lg.info(
				{ leadSearchId, status: leadSearch.status },
				"LeadSearch finished; skipping job tick"
			);
			return;
		}

		if (leadSearch.kind === LeadSearchKind.LEAD_DB) {
			await this.leadDbHandler.run(
				leadSearchId,
				job.data.triggeredById ?? undefined,
				lg
			);
			return;
		}

		if (leadSearch.kind === LeadSearchKind.SCRAPER) {
			if (!token) {
				throw new Error("BullMQ token is required for SCRAPER step-jobs");
			}
			await this.scraperStepHandler.process(job, token, lg);
			return;
		}

		const _exhaustive: never = leadSearch.kind;
		throw new Error(`LeadSearch kind=${String(_exhaustive)} is not supported`);
	}

	/**
	 * Inline runner (dev fallback if Redis/Queue not configured).
	 */
	async runInline(
		leadSearchId: string,
		triggeredById?: string,
		log?: LoggerLike
	): Promise<void> {
		const lg = ensureLogger(log);

		const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
		if (!leadSearch) throw new Error("LeadSearch not found");

		// Same hard idempotency as queue worker.
		if (
			leadSearch.status === LeadSearchStatus.DONE ||
			leadSearch.status === LeadSearchStatus.DONE_NO_RESULTS ||
			leadSearch.status === LeadSearchStatus.FAILED
		) {
			lg.info(
				{ leadSearchId, status: leadSearch.status },
				"LeadSearch finished; skipping inline run"
			);
			return;
		}

		if (leadSearch.kind === LeadSearchKind.LEAD_DB) {
			await this.leadDbHandler.run(leadSearchId, triggeredById, lg);
			return;
		}

		if (leadSearch.kind === LeadSearchKind.SCRAPER) {
			// Safety: do not allow SCRAPER inline in production.
			if (this.isProd()) {
				throw new Error("SCRAPER LeadSearch must run via queue in production");
			}
			await this.scraperInlineHandler.run(leadSearchId, triggeredById, lg);
			return;
		}

		const _exhaustive: never = leadSearch.kind;
		throw new Error(`LeadSearch kind=${String(_exhaustive)} is not supported`);
	}
}
