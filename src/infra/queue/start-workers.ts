import type { Redis } from "ioredis";

import { container } from "@/container";
import { loadEnv } from "@/config/env";
import { QUEUE_TYPES } from "./queue.types";
import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { startLeadSearchWorker } from "./lead-search/lead-search.worker";
import { startLeadRagIndexWorker } from "./lead-rag/lead-rag-index.worker";

const env = loadEnv();

export type WorkersHandle = {
	close: () => Promise<void>;
};

export function startWorkers(log?: LoggerLike): WorkersHandle | null {
	const lg = ensureLogger(log);

	let redis: Redis | null = null;
	try {
		redis = container.get<Redis>(QUEUE_TYPES.Redis);
	} catch {
		redis = null;
	}

	if (!redis) {
		lg.warn({}, "Redis is not configured; workers not started");
		return null;
	}

	const leadSearchWorker = startLeadSearchWorker({
		redis,
		concurrency: env.LEAD_SEARCH_QUEUE_CONCURRENCY,
	});

	const leadRagIndexWorker = startLeadRagIndexWorker({
		redis,
		concurrency: env.LEAD_RAG_INDEX_QUEUE_CONCURRENCY,
	});

	lg.info({}, "Workers started");

	return {
		async close() {
			lg.info({}, "Shutting down workers...");

			try {
				await leadSearchWorker.close();
			} catch (err) {
				lg.error({ err }, "LeadSearch worker close error");
			}

			try {
				await leadRagIndexWorker.close();
			} catch (err) {
				lg.error({ err }, "LeadRagIndex worker close error");
			}

			try {
				await redis.quit();
			} catch (err) {
				lg.error({ err }, "Redis quit error");
			}

			lg.info({}, "Workers stopped");
		},
	};
}
