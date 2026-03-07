import { UserFacingError } from "@/infra/userFacingError";

/**
 * Sentinel error thrown when Apify responds with HTTP 429 (rate limit).
 * The CrunchbaseApifyProvider catches this to return `null` (skip silently).
 */
export class CrunchbaseApifyRateLimitError extends Error {
  constructor() {
    super("Crunchbase Apify rate limit reached");
    this.name = "CrunchbaseApifyRateLimitError";
  }
}

/**
 * Inspect an unknown thrown value from a Crunchbase Apify call and wrap it
 * into a `UserFacingError` or `CrunchbaseApifyRateLimitError`.
 *
 * The provider layer only needs to handle `CrunchbaseApifyRateLimitError`;
 * everything else is treated as a skip (logged and swallowed).
 */
export function wrapCrunchbaseApifyError(e: unknown): void {
  if (e instanceof UserFacingError) throw e;
  if (e instanceof CrunchbaseApifyRateLimitError) throw e;

  // ApifyApiError from the `apify-client` package has a `statusCode` property.
  const statusCode =
    typeof e === "object" && e !== null && "statusCode" in e
      ? (e as { statusCode?: number }).statusCode
      : undefined;

  if (statusCode === 429) {
    throw new CrunchbaseApifyRateLimitError();
  }

  const msg = e instanceof Error ? e.message : String(e);
  console.warn("[CrunchbaseApify] error:", msg);
  // Swallow — provider will treat this as "no result".
}
