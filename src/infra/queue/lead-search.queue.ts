import { Queue } from "bullmq";
import type { Redis } from "ioredis";

import { loadEnv } from "@/config/env";

export const LEAD_SEARCH_QUEUE_NAME = "lead-search";

export type LeadSearchJobName = "leadSearch.run";

export type LeadSearchJobData = {
	leadSearchId: string;
	triggeredById?: string | null;
};

const env = loadEnv();

export function createLeadSearchQueue(redis: Redis) {
	return new Queue<LeadSearchJobData, void, LeadSearchJobName>(
		LEAD_SEARCH_QUEUE_NAME,
		{
			connection: redis,
			// defaultJobOptions can be kept here, but I prefer to set it in add()
		}
	);
}

export function leadSearchJobOptions() {
	const attempts = env.LEAD_SEARCH_QUEUE_ATTEMPTS;
	const backoffMs = env.LEAD_SEARCH_QUEUE_BACKOFF_MS;

	return {
		attempts,
		backoff: { type: "exponential" as const, delay: backoffMs },
		removeOnComplete: true,
		removeOnFail: false,
	};
}
