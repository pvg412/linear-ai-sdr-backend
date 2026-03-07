/**
 * Shared DTOs and interface contract for Reddit signal providers.
 *
 * Providers are kept fully behind this interface so that no provider
 * implementation detail (brand names, URLs, etc.) ever surfaces to
 * the pipeline layer or the frontend.
 */

export interface RedditSignalSearchInput {
  /** Company name to search for (from lead.company). */
  companyName: string;
  /** Optional company domain hint (from lead.companyDomain). */
  companyDomain?: string | null;
  /** Lead ID this search is performed on behalf of. */
  leadId: string;
  /** Active subreddit names to search within (without "r/" prefix). */
  subreddits: string[];
}

export interface RedditSignalPostDto {
  /** Subreddit where this was found (without "r/" prefix). */
  subreddit: string;
  /** "post" or "comment" */
  postType: string;
  /** "mention" (keyword hit) or "activity" (company's own post). */
  signalType: string;
  title?: string | null;
  content?: string | null;
  author?: string | null;
  url?: string | null;
  /** Reddit score (upvotes − downvotes). */
  score?: number | null;
  /** Number of comments on this post. */
  numComments?: number | null;
  /** UTC date string, e.g. "2026-01-15". */
  createdUtc?: string | null;
}

export interface RedditSignalResult {
  /** Opaque provider identifier, e.g. "reddit-apify". Never surfaced to the frontend. */
  providerKey: string;
  /** Company name that was queried. */
  companyName: string;
  /** Total posts/comments mentioning the company. */
  totalMentions: number;
  /** Total posts/comments by the company account (0 when profile scraping is skipped). */
  totalActivities: number;
  /** Subreddits where matches were found. */
  subredditsFound: string[];
  /** Individual Reddit posts/comments found. */
  posts: RedditSignalPostDto[];
}

/** Company information for batch processing. */
export interface RedditSignalCompanyInfo {
  /** Company name (from lead.company). */
  companyName: string;
  /** Optional company domain (from lead.companyDomain). */
  companyDomain?: string | null;
  /** Lead IDs associated with this company. */
  leadIds: string[];
}

export interface RedditSignalBatchInput {
  /** Companies to search for in a single batch. */
  companies: RedditSignalCompanyInfo[];
  /** Active subreddit names to search within (without "r/" prefix). */
  subreddits: string[];
}

export interface RedditSignalProvider {
  /** Short opaque key that uniquely identifies this provider. */
  readonly key: string;

  /** Returns false when the provider is misconfigured (e.g. missing API key). */
  isEnabled(): boolean;

  /**
   * Queries the provider for Reddit signals at the given company.
   *
   * Returns `null` when the daily rate limit has been reached — the caller
   * must skip this provider silently without failing the pipeline.
   *
   * May throw for unexpected errors; callers are responsible for catching
   * and logging those without re-throwing (graceful degradation).
   */
  detectRedditSignals(
    input: RedditSignalSearchInput,
  ): Promise<RedditSignalResult | null>;

  /**
   * Batch version: queries the provider for Reddit signals for multiple companies at once.
   *
   * Returns a Map keyed by normalized company name (lowercased trim).
   * Missing companies in the result indicate rate limit reached or no matches found.
   *
   * Optional method — if not implemented, caller falls back to per-company calls.
   */
  detectRedditSignalsBatch?(
    input: RedditSignalBatchInput,
  ): Promise<Map<string, RedditSignalResult>>;
}
