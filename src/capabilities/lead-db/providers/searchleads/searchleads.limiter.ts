import type { Redis } from "ioredis";

import { sleep } from "@/capabilities/shared/polling";

import {
  SEARCHLEADS_LIMITS,
  SEARCHLEADS_REDIS_KEYS,
} from "./searchleads.limits";
import { getLeadSearchAsyncContext } from "@/infra/async-context/leadSearchAsyncContext";

type ThrottleReason = "RATE_LIMIT" | "CONCURRENCY";

function nowMs(): number {
  return Date.now();
}

function msUntilNextMinute(tMs: number): number {
  const next = (Math.floor(tMs / 60_000) + 1) * 60_000;
  return Math.max(0, next - tMs);
}

function formatRetryMinutes(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return `${mins} мин`;
}

export class SearchLeadsLimiter {
  private inMemoryActiveTasks = 0;

  constructor(private readonly redis: Redis | null) {}

  private notify(reason: ThrottleReason, retryAfterMs: number): void {
    const ctx = getLeadSearchAsyncContext();
    if (!ctx?.onThrottle) return;

    const message =
      reason === "RATE_LIMIT"
        ? `Service temporarily limits request processing speed. We'll retry in ${formatRetryMinutes(retryAfterMs)}.`
        : `Service overloaded. Request queued, will continue in ${formatRetryMinutes(retryAfterMs)}.`;

    ctx.onThrottle({ reason, retryAfterMs, message });
  }

  /**
   * Ensures we don't exceed active parallel tasks.
   * This is a soft wait loop that will block until a slot is available.
   */
  async withTaskSlot<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForTaskSlot();
    try {
      return await fn();
    } finally {
      await this.releaseTaskSlot();
    }
  }

  private async waitForTaskSlot(): Promise<void> {
    while (true) {
      const acquired = await this.tryAcquireTaskSlot();
      if (acquired) return;

      // Small backoff; we only use this when the system is overloaded.
      const delayMs = 5_000;
      this.notify("CONCURRENCY", delayMs);
      await sleep(delayMs);
    }
  }

  private async tryAcquireTaskSlot(): Promise<boolean> {
    if (!this.redis) {
      if (this.inMemoryActiveTasks >= SEARCHLEADS_LIMITS.maxConcurrentTasks) {
        return false;
      }
      this.inMemoryActiveTasks += 1;
      return true;
    }

    // Fixed-window counter for active tasks.
    // NOTE: This assumes tasks are well-behaved and release on completion.
    const n = await this.redis.incr(SEARCHLEADS_REDIS_KEYS.activeTasks);
    if (n === 1) {
      // safety TTL in case of crashes/leaks
      await this.redis.expire(SEARCHLEADS_REDIS_KEYS.activeTasks, 2 * 60 * 60);
    }

    if (n > SEARCHLEADS_LIMITS.maxConcurrentTasks) {
      await this.redis.decr(SEARCHLEADS_REDIS_KEYS.activeTasks).catch(() => {});
      return false;
    }

    return true;
  }

  private async releaseTaskSlot(): Promise<void> {
    if (!this.redis) {
      this.inMemoryActiveTasks = Math.max(0, this.inMemoryActiveTasks - 1);
      return;
    }

    await this.redis.decr(SEARCHLEADS_REDIS_KEYS.activeTasks).catch(() => {});
  }

  /**
   * Ensures global (cross-process) request rate <= 30/min.
   * Blocks until a slot in the current minute window is available.
   */
  async waitForRequestSlot(): Promise<void> {
    while (true) {
      const ok = await this.tryAcquireRequestSlot();
      if (ok) return;

      const delayMs = msUntilNextMinute(nowMs());
      const bounded = Math.min(delayMs, 60_000);
      this.notify("RATE_LIMIT", bounded);
      await sleep(bounded);
    }
  }

  private async tryAcquireRequestSlot(): Promise<boolean> {
    const t = nowMs();
    const windowId = Math.floor(t / 60_000);

    if (!this.redis) {
      // In-memory fallback is per-process; acceptable only for dev.
      // We'll approximate by always allowing.
      return true;
    }

    const key = `${SEARCHLEADS_REDIS_KEYS.requestsPerMinutePrefix}${windowId}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      // expire shortly after window ends
      await this.redis.expire(key, 70);
    }

    return n <= SEARCHLEADS_LIMITS.maxRequestsPerMinute;
  }
}
