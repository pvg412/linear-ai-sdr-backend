import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { QUEUE_TYPES } from "./queue.types";
import { startLeadSearchWorker } from "./lead-search.worker";
import { loadEnv } from "@/config/env";

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

	const worker = startLeadSearchWorker({
		redis,
		concurrency: env.LEAD_SEARCH_QUEUE_CONCURRENCY,
	});

	lg.info({}, "Workers started");

	return {
		async close() {
			lg.info({}, "Shutting down workers...");

			try {
				await worker.close();
			} catch (err) {
				lg.error({ err }, "Worker close error");
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
