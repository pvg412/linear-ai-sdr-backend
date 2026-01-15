import { AsyncLocalStorage } from "node:async_hooks";

export type LeadSearchAsyncContext = {
  /**
   * Optional callback to inform user-facing UI about throttling/backpressure.
   * IMPORTANT: message must not mention any provider name.
   */
  onThrottle?: (args: {
    reason: "RATE_LIMIT" | "CONCURRENCY";
    retryAfterMs: number;
    message: string;
  }) => void;
};

const storage = new AsyncLocalStorage<LeadSearchAsyncContext>();

export function withLeadSearchAsyncContext<T>(
  ctx: LeadSearchAsyncContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getLeadSearchAsyncContext(): LeadSearchAsyncContext | undefined {
  return storage.getStore();
}
