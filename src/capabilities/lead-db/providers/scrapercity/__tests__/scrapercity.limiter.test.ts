import { describe, it, expect, vi } from "vitest";

import { ScraperCityLimiter } from "../scrapercity.limiter";
import { withLeadSearchAsyncContext } from "@/infra/async-context/leadSearchAsyncContext";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ScraperCityLimiter", () => {
  async function flushMicrotasks(rounds = 50): Promise<void> {
    // English comment: make promise continuations run deterministically under fake timers
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
      vi.runAllTicks();
    }
  }

  it("throttles after 100 requests/min and notifies async context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const limiter = new ScraperCityLimiter(null);
    const throttles: Array<{
      reason: string;
      retryAfterMs: number;
      message: string;
    }> = [];

    await withLeadSearchAsyncContext(
      { onThrottle: (t) => throttles.push(t) },
      async () => {
        for (let i = 0; i < 100; i += 1) {
          await limiter.waitForRequestSlot();
        }

        const p = limiter.waitForRequestSlot();
        await flushMicrotasks();

        expect(throttles.some((t) => t.reason === "RATE_LIMIT")).toBe(true);

        await vi.advanceTimersByTimeAsync(60_000);
        await expect(p).resolves.toBeUndefined();
      },
    );

    vi.useRealTimers();
  });

  it("limits concurrent tasks to 10 and notifies async context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const limiter = new ScraperCityLimiter(null);
    const throttles: Array<{
      reason: string;
      retryAfterMs: number;
      message: string;
    }> = [];

    let entered = 0;
    const gates = Array.from({ length: 10 }, () => deferred<void>());

    await withLeadSearchAsyncContext(
      { onThrottle: (t) => throttles.push(t) },
      async () => {
        const running = gates.map((g) =>
          limiter.withTaskSlot(async () => {
            entered += 1;
            await g.promise;
          }),
        );

        await flushMicrotasks();
        expect(entered).toBe(10);

        const extra = limiter.withTaskSlot(() => {
          entered += 1;
          return Promise.resolve();
        });

        await flushMicrotasks();
        expect(entered).toBe(10);
        expect(throttles.some((t) => t.reason === "CONCURRENCY")).toBe(true);

        // Release one slot, then the queued task should enter after next retry tick (5s).
        gates[0]?.resolve();
        await running[0];

        await vi.advanceTimersByTimeAsync(5_000);
        vi.runAllTicks();
        await flushMicrotasks();
        await extra;

        expect(entered).toBe(11);

        // Cleanup
        for (let i = 1; i < gates.length; i += 1) gates[i]?.resolve();
        await Promise.all(running.slice(1));
      },
    );

    vi.useRealTimers();
  });
});
