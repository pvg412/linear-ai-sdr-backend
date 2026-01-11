import { inject, injectable, optional } from "inversify";
import { Queue } from "bullmq";

import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { LEAD_SEARCH_TYPES } from "../lead-search.types";
import { LeadSearchRepository } from "../persistence/lead-search.repository";
import { QUEUE_TYPES } from "@/infra/queue/queue.types";
import {
	type LeadSearchJobData,
	type LeadSearchJobName,
	leadSearchJobOptions,
} from "@/infra/queue/lead-search/lead-search.queue";

@injectable()
export class LeadSearchRecoveryService {
	constructor(
		@inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
		private readonly leadSearchRepository: LeadSearchRepository,

		@inject(QUEUE_TYPES.LeadSearchQueue)
		@optional()
		private readonly leadSearchQueue?: Queue<
			LeadSearchJobData,
			void,
			LeadSearchJobName
		>
	) {}

	async recover(log?: LoggerLike): Promise<void> {
		const lg = ensureLogger(log);

		if (!this.leadSearchQueue) {
			lg.warn("QUEUE: Redis not configured; skipping LeadSearch recovery");
			return;
		}

		lg.info("RECOVERY: checking for stuck LeadSearch jobs...");

		const running = await this.leadSearchRepository.findRunningSearches();
		if (running.length === 0) {
			lg.info("RECOVERY: no running searches found");
			return;
		}

		lg.info(
			{ count: running.length },
			"RECOVERY: found RUNNING searches in DB"
		);

		for (const search of running) {
			try {
				const existingJob = await this.leadSearchQueue.getJob(search.id);
				
				// If job exists and is not failed/finished, it's fine.
				if (existingJob) {
					const state = await existingJob.getState();
					
					if (state === "failed") {
						lg.warn(
							{ leadSearchId: search.id, jobId: existingJob.id },
							"RECOVERY: job is FAILED in Redis but RUNNING in DB; retrying job"
						);
						await existingJob.retry();
						continue;
					}

					lg.debug(
						{ leadSearchId: search.id, jobId: existingJob.id, state },
						"RECOVERY: job already exists (alive)"
					);
					
					continue;
				}

				// If job is missing, re-enqueue it.
				lg.warn(
					{ leadSearchId: search.id },
					"RECOVERY: job missing from Queue; re-enqueuing to resume polling"
				);

				await this.leadSearchQueue.add(
					"leadSearch.run",
					{ leadSearchId: search.id, triggeredById: search.createdById },
					{ jobId: search.id, ...leadSearchJobOptions() }
				);

			} catch (err) {
				lg.error(
					{ err, leadSearchId: search.id },
					"RECOVERY: failed to check/enqueue job"
				);
			}
		}

		lg.info("RECOVERY: finished LeadSearch recovery check");
	}
}
