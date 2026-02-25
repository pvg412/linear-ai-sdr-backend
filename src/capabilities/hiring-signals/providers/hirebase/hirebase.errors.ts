import {
  isAxiosError,
  formatAxiosErrorForLog,
} from "@/capabilities/shared/axiosError";
import type { HirebaseErrorResponse } from "./hirebase.dto";

/**
 * Sentinel error thrown when Hirebase responds with HTTP 429 (rate limit).
 * The HirebaseProvider catches this to return `null` (skip silently).
 */
export class HirebaseRateLimitError extends Error {
  readonly retryAfterSeconds: number | undefined;

  constructor(retryAfterSeconds?: number) {
    super("Hirebase rate limit reached");
    this.name = "HirebaseRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseErrorBody(data: unknown): HirebaseErrorResponse {
  if (typeof data === "object" && data !== null) {
    return data as HirebaseErrorResponse;
  }
  return {};
}

/**
 * Inspect an unknown thrown value from a Hirebase HTTP call and:
 * - Throw `HirebaseRateLimitError` for HTTP 429
 * - Log and return (swallow) for other HTTP errors (4xx/5xx)
 * - Return without re-throwing for non-HTTP errors
 *
 * This keeps the provider layer clean — it only needs to handle
 * `HirebaseRateLimitError`; everything else is treated as a skip.
 */
export function wrapHirebaseError(e: unknown): void {
  if (!isAxiosError(e)) {
    // Non-HTTP error (network timeout, etc.) — log and swallow
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Hirebase] non-HTTP error:", msg);
    return;
  }

  console.warn("[Hirebase] HTTP error", formatAxiosErrorForLog(e));

  const status = e.response?.status;
  const body = parseErrorBody(e.response?.data);

  if (status === 429) {
    const retryAfter =
      typeof body.details?.retry_after === "number"
        ? body.details.retry_after
        : undefined;
    throw new HirebaseRateLimitError(retryAfter);
  }

  // 401 / 403 / 422 / 5xx — log already done above, just swallow.
  // The provider will treat a swallowed error as "no result" (returns null).
}
