import { DelayedError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger } from "@/infra/observability";

import {
	LEAD_SEARCH_QUEUE_NAME,
	type LeadSearchJobData,
	type LeadSearchJobName,
} from "./lead-search.queue";
import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchRunnerService } from "@/modules/lead-search/lead-search.runner.service";

function isBullMqControlError(err: unknown): boolean {
	return err instanceof DelayedError;
}

export function startLeadSearchWorker(args: {
	redis: Redis;
	concurrency?: number;
}) {
	const lg = ensureLogger();

	const worker = new Worker<LeadSearchJobData, void, LeadSearchJobName>(
		LEAD_SEARCH_QUEUE_NAME,
		async (
			job: Job<LeadSearchJobData, void, LeadSearchJobName>,
			token?: string
		) => {
			const runner = container.get<LeadSearchRunnerService>(
				LEAD_SEARCH_TYPES.LeadSearchRunnerService
			);

			await runner.processQueueJob(job, token, lg);
		},
		{
			connection: args.redis,
			concurrency: args.concurrency ?? 1,
		}
	);

	worker.on("completed", (job) => {
		lg.info(
			{
				jobId: job.id,
				leadSearchId: job.data.leadSearchId,
			},
			"LeadSearch job completed"
		);
	});

	worker.on("stalled", (jobId) => {
		lg.warn({ jobId }, "LeadSearch job stalled");
	});

	worker.on("failed", (job, err) => {
		if (isBullMqControlError(err)) return;

		lg.error(
			{
				err,
				jobId: job?.id ?? null,
				leadSearchId: job?.data?.leadSearchId ?? null,
				step: job?.data?.scraper?.step ?? null,
				attemptsMade: job?.attemptsMade ?? null,
				maxAttempts: job?.opts?.attempts ?? null,
			},
			"LeadSearch job failed"
		);
	});

	worker.on("error", (err) => {
		lg.error({ err }, "LeadSearch worker error");
	});

	lg.info(
		{ queue: LEAD_SEARCH_QUEUE_NAME, concurrency: args.concurrency ?? 1 },
		"LeadSearch worker started"
	);

	return worker;
}
