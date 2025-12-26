import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchRunnerService } from "@/modules/lead-search/lead-search.runner.service";

import {
	LEAD_SEARCH_QUEUE_NAME,
	type LeadSearchJobData,
	type LeadSearchJobName,
} from "./lead-search.queue";
import { loadEnv } from "@/config/env";

const env = loadEnv();

export function startLeadSearchWorker(args: {
	redis: Redis;
	log?: LoggerLike;
}) {
	const lg = ensureLogger(args.log);
	const concurrency = env.LEAD_SEARCH_QUEUE_CONCURRENCY;

	const worker = new Worker<LeadSearchJobData, void, LeadSearchJobName>(
		LEAD_SEARCH_QUEUE_NAME,
		async (job) => {
			const { leadSearchId, triggeredById } = job.data;

			lg.info(
				{
					leadSearchId,
					triggeredById,
					jobId: job.id,
					attempt: job.attemptsMade,
				},
				"LeadSearch job started"
			);

			const runner = container.get<LeadSearchRunnerService>(
				LEAD_SEARCH_TYPES.LeadSearchRunnerService
			);

			await runner.run(leadSearchId, triggeredById ?? undefined, lg);

			lg.info(
				{ leadSearchId, triggeredById, jobId: job.id },
				"LeadSearch job finished"
			);
		},
		{
			connection: args.redis,
			concurrency,
		}
	);

	worker.on("failed", (job, err) => {
		lg.error(
			{
				err,
				jobId: job?.id ?? null,
				leadSearchId: job?.data?.leadSearchId ?? null,
				attemptsMade: job?.attemptsMade ?? null,
			},
			"LeadSearch job failed"
		);
	});

	worker.on("error", (err) => {
		lg.error({ err }, "LeadSearch worker error");
	});

	return worker;
}
