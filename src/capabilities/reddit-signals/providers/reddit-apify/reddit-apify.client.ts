import { ApifyClient } from "apify-client";

import { loadEnv } from "@/config/env";
import { UserFacingError } from "@/infra/userFacingError";
import { ensureLogger } from "@/infra/observability";

import {
  RedditScrapedPostSchema,
  type RedditScrapedPost,
} from "./reddit-apify.schemas";

const DEFAULT_ACTOR_ID = "harshmaur/reddit-scraper-pro";
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 2_000;
const WAIT_SECS = 120;
const MAX_ITEMS_PER_SUBREDDIT = 25;
const MAX_ITEMS_PER_BATCH = 500; // Cap for batch requests
const BASE_WAIT_SECS_BATCH = 120;
const WAIT_SECS_PER_KEYWORD = 5; // Additional wait per keyword
const MAX_WAIT_SECS = 300; // 5 minutes max

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; backoffMs: number; label: string },
): Promise<T> {
  const lg = ensureLogger();
  let lastError: Error = new Error("No attempts made");
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < options.maxAttempts) {
        lg.warn(
          { attempt, maxAttempts: options.maxAttempts, err: lastError, label: options.label },
          "Reddit Apify call failed, retrying",
        );
        await sleep(options.backoffMs * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
}

/**
 * Thin client for the `harshmaur/reddit-scraper-pro` Apify actor.
 *
 * Uses the synchronous `.call()` pattern (waits for the actor to finish).
 * Searches a single subreddit for posts matching a keyword.
 */
export class RedditApifyClient {
  private client: ApifyClient | null = null;
  private readonly actorId: string;

  constructor(actorId: string = DEFAULT_ACTOR_ID) {
    this.actorId = actorId;
  }

  private getClient(): ApifyClient {
    if (!this.client) {
      const env = loadEnv();
      if (!env.APIFY_TOKEN) {
        throw new UserFacingError({
          code: "SERVICE_UNAVAILABLE",
          userMessage: "Reddit scraper service is not configured",
        });
      }
      this.client = new ApifyClient({ token: env.APIFY_TOKEN });
    }
    return this.client;
  }

  /**
   * Search a subreddit for posts matching a keyword.
   *
   * Returns an array of parsed Reddit posts.
   * Throws the raw Apify error on failures — callers must wrap.
   */
  async searchSubreddit(
    subreddit: string,
    keyword: string,
    maxItems: number = MAX_ITEMS_PER_SUBREDDIT,
  ): Promise<RedditScrapedPost[]> {
    const client = this.getClient();
    const lg = ensureLogger();

    const input = {
      startUrls: [{ url: `https://www.reddit.com/r/${subreddit}/` }],
      searchMode: true,
      searches: [keyword],
      sort: "relevance",
      time: "month",
      maxItems,
      skipComments: false,
    };

    const run = await withRetry(
      () => client.actor(this.actorId).call(input, { waitSecs: WAIT_SECS }),
      { maxAttempts: MAX_RETRIES, backoffMs: RETRY_BACKOFF_MS, label: `r/${subreddit}:${keyword}` },
    );

    if (!run.defaultDatasetId) {
      lg.warn({ subreddit, keyword }, "Reddit scraper returned no dataset");
      return [];
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems({
      limit: maxItems,
    });

    if (!items || items.length === 0) {
      return [];
    }

    const posts: RedditScrapedPost[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      // Skip info/error messages from the actor
      if ("message" in item && !("id" in item)) continue;

      try {
        posts.push(RedditScrapedPostSchema.parse(item));
      } catch (err) {
        lg.warn({ err, subreddit, keyword }, "Failed to parse Reddit post");
      }
    }

    return posts;
  }

  /**
   * Search multiple subreddits for multiple keywords (companies) in a single batch.
   *
   * Returns an array of parsed Reddit posts with all matching content.
   * Throws the raw Apify error on failures — callers must wrap.
   *
   * @param subreddits - Array of subreddit names (without "r/" prefix)
   * @param keywords - Array of company names to search for
   * @param maxItemsPerKeyword - Maximum items per keyword (default: 25)
   */
  async searchBatch(
    subreddits: string[],
    keywords: string[],
    maxItemsPerKeyword: number = MAX_ITEMS_PER_SUBREDDIT,
  ): Promise<RedditScrapedPost[]> {
    if (subreddits.length === 0 || keywords.length === 0) {
      return [];
    }

    const client = this.getClient();
    const lg = ensureLogger();

    // Build startUrls for all subreddits
    const startUrls = subreddits.map((subreddit) => ({
      url: `https://www.reddit.com/r/${subreddit}/`,
    }));

    // Calculate scaled maxItems with cap
    const totalMaxItems = Math.min(
      maxItemsPerKeyword * subreddits.length * keywords.length,
      MAX_ITEMS_PER_BATCH,
    );

    // Calculate scaled wait time based on workload
    const scaledWaitSecs = Math.min(
      BASE_WAIT_SECS_BATCH + keywords.length * subreddits.length * WAIT_SECS_PER_KEYWORD,
      MAX_WAIT_SECS,
    );

    const input = {
      startUrls,
      searchMode: true,
      searches: keywords,
      sort: "relevance",
      time: "month",
      maxItems: totalMaxItems,
      skipComments: false,
    };

    lg.info(
      {
        subredditCount: subreddits.length,
        keywordCount: keywords.length,
        maxItems: totalMaxItems,
        waitSecs: scaledWaitSecs,
      },
      "Reddit batch scrape starting",
    );

    const run = await withRetry(
      () => client.actor(this.actorId).call(input, { waitSecs: scaledWaitSecs }),
      {
        maxAttempts: MAX_RETRIES,
        backoffMs: RETRY_BACKOFF_MS,
        label: `batch:${subreddits.length}sr×${keywords.length}kw`,
      },
    );

    if (!run.defaultDatasetId) {
      lg.warn({ subreddits, keywords }, "Reddit batch scraper returned no dataset");
      return [];
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems({
      limit: totalMaxItems,
    });

    if (!items || items.length === 0) {
      return [];
    }

    const posts: RedditScrapedPost[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      // Skip info/error messages from the actor
      if ("message" in item && !("id" in item)) continue;

      try {
        posts.push(RedditScrapedPostSchema.parse(item));
      } catch (err) {
        lg.warn({ err }, "Failed to parse Reddit post in batch");
      }
    }

    lg.info(
      { subreddits, keywords, postsFound: posts.length },
      "Reddit batch scrape completed",
    );

    return posts;
  }
}
