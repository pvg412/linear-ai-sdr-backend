import { UserFacingError } from "@/infra/userFacingError";

/**
 * Sentinel error thrown when Apify responds with HTTP 429 (rate limit).
 * The RedditApifyProvider catches this to return `null` (skip silently).
 */
export class RedditApifyRateLimitError extends Error {
  constructor() {
    super("Reddit Apify rate limit reached");
    this.name = "RedditApifyRateLimitError";
  }
}

/**
 * Inspect an unknown thrown value from a Reddit Apify call and wrap it
 * into a `UserFacingError` or `RedditApifyRateLimitError`.
 *
 * The provider layer only needs to handle `RedditApifyRateLimitError`;
 * everything else is treated as a skip.
 */
export function wrapRedditApifyError(e: unknown): void {
  if (e instanceof UserFacingError) throw e;
  if (e instanceof RedditApifyRateLimitError) throw e;

  // ApifyApiError from the `apify-client` package has a `statusCode` property.
  const statusCode =
    typeof e === "object" && e !== null && "statusCode" in e
      ? (e as { statusCode?: number }).statusCode
      : undefined;

  if (statusCode === 429) {
    throw new RedditApifyRateLimitError();
  }

  const msg = e instanceof Error ? e.message : String(e);
  console.warn("[RedditApify] error:", msg);
  // Swallow — provider will treat this as "no result".
}
