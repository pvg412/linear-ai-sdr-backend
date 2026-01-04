import { Queue } from "bullmq";
import type { Redis } from "ioredis";

import { loadEnv } from "@/config/env";

export const LEAD_RAG_INDEX_QUEUE_NAME = "lead-rag-index";

export type LeadRagIndexJobName = "leadRag.upsertLead" | "leadRag.deleteLead";

export type LeadRagIndexJobData = {
	ownerId: string;
	leadId: string;
	reason?: string | null;
	requestedAtMs?: number | null;
};

const env = loadEnv();

export function createLeadRagIndexQueue(redis: Redis) {
	return new Queue<LeadRagIndexJobData, void, LeadRagIndexJobName>(
		LEAD_RAG_INDEX_QUEUE_NAME,
		{ connection: redis }
	);
}

export function leadRagIndexJobOptions() {
	// Reuse lead-search knobs if you don't want new env vars
	const attempts = env.LEAD_RAG_INDEX_QUEUE_ATTEMPTS;
	const backoffMs = env.LEAD_RAG_INDEX_QUEUE_BACKOFF_MS;

	return {
		attempts,
		backoff: { type: "exponential" as const, delay: backoffMs },
		removeOnComplete: true,
		removeOnFail: false,
	};
}
