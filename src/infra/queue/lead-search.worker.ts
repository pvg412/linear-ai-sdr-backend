import { Worker, type Job } from "bullmq";
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

function isSpecialBullMqControlError(err: unknown): boolean {
	// We don't want to treat these as "job failed" in logs.
	const name = (err as { name?: string } | null)?.name;
	return (
		name === "DelayedError" ||
		name === "WaitingChildrenError" ||
		name === "WaitingError" ||
		name === "RateLimitError"
	);
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
		// BullMQ step-jobs intentionally throw DelayedError after moveToDelayed.
		// Do not treat that as a real failure.
		if (isSpecialBullMqControlError(err)) return;

		const jobId = job?.id ?? null;
		const data = job?.data;
		const leadSearchId = data?.leadSearchId ?? null;

		const attemptsMade = job?.attemptsMade ?? null;
		const maxAttempts = job?.opts?.attempts ?? null;

		// NOTE: attemptsMade semantics: it increments on "regular" completion/failure,
		const willRetry =
			typeof attemptsMade === "number" &&
			typeof maxAttempts === "number" &&
			attemptsMade < maxAttempts;

		lg.error(
			{
				err,
				jobId,
				leadSearchId,
				attemptsMade,
				maxAttempts,
				willRetry,
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
