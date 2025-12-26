import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { QUEUE_TYPES } from "./queue.types";
import { startLeadSearchWorker } from "./lead-search.worker";

/**
 * Start workers inside current process (convenient for dev and simple deployment).
 * In production you can run it in a separate process - see below worker entrypoint.
 */
export function startWorkers(log?: LoggerLike): void {
  const lg = ensureLogger(log);

  // If Redis is not bound - then REDIS_URL is not set.
  let redis: Redis | null = null;
  try {
    redis = container.get<Redis>(QUEUE_TYPES.Redis);
  } catch {
    redis = null;
  }

  if (!redis) {
    lg.warn({}, "Redis is not configured; workers not started");
    return;
  }

  const worker = startLeadSearchWorker({ redis, log: lg });

  const shutdown = async () => {
    try {
      lg.info({}, "Shutting down workers...");
      await worker.close();
      await redis.quit();
      lg.info({}, "Workers stopped");
    } catch (err) {
      lg.error({ err }, "Worker shutdown error");
    }
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  lg.info({}, "Workers started");
}
