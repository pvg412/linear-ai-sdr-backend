import IORedis, { type Redis } from "ioredis";

import { loadEnv } from "@/config/env";

const env = loadEnv();

/**
 * Creates Redis client if REDIS_URL exists.
 * If not set - returns null (so tests/dev can run without Redis).
 */
export function tryCreateRedisClient(): Redis | null {
  const url = env.REDIS_URL?.trim();
  if (!url) return null;

  const redis = new IORedis(url, {
    // BullMQ recommendation: do not retry per request (it can stall jobs)
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on("error", (err) => {
    console.error("[redis] error", err);
  });

  return redis;
}
