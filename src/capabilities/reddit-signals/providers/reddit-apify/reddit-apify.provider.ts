import { injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { ensureLogger } from "@/infra/observability";
import type { ServiceToggleService } from "@/modules/admin/services/service-toggle.service";

import type {
  RedditSignalProvider,
  RedditSignalSearchInput,
  RedditSignalResult,
  RedditSignalPostDto,
  RedditSignalBatchInput,
} from "@/capabilities/reddit-signals/reddit-signal-provider.dto";
import { RedditApifyClient } from "./reddit-apify.client";
import {
  RedditApifyRateLimitError,
  wrapRedditApifyError,
} from "./reddit-apify.errors";
import type { RedditScrapedPost } from "./reddit-apify.schemas";
import {
  normalizeCompanyName,
  matchesCompanyName,
  matchesDomain,
  MIN_MATCHABLE_NAME_LENGTH,
} from "./company-match.utils";

/** Opaque key used in DB records. Never shown to the frontend. */
const PROVIDER_KEY = "reddit-apify";

/** ServiceToggle key for enabling/disabling the Reddit signal globally. */
const SERVICE_KEY = "reddit-scraper";

/**
 * Maximum number of requests per UTC calendar day.
 * Conservative default — adjust based on Apify plan limits.
 */
const DAILY_REQUEST_LIMIT = 500;

/** Fallback: maximum number of items to retrieve per subreddit search. */
const DEFAULT_MAX_ITEMS_PER_SUBREDDIT = 25;

/** Fallback: maximum number of posts to keep per company across all subreddits. */
const DEFAULT_MAX_POSTS_PER_COMPANY = 50;

/** How many subreddit searches to run concurrently per company. */
const SUBREDDIT_CONCURRENCY = 3;

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Reddit signal provider backed by the `harshmaur/reddit-scraper-pro` Apify actor.
 *
 * Strategy: for each active subreddit, search by company name as keyword.
 * Each subreddit search is one API call. Daily request quota is tracked in
 * the `SignalProviderDailyUsage` table.
 */
@injectable()
export class RedditApifyProvider implements RedditSignalProvider {
  readonly key = PROVIDER_KEY;

  private readonly client: RedditApifyClient;
  private readonly prisma = getPrisma();
  private readonly serviceToggle: ServiceToggleService;
  private readonly hasToken: boolean;

  constructor(apifyToken: string, serviceToggle: ServiceToggleService) {
    this.hasToken = Boolean(apifyToken);
    this.client = new RedditApifyClient();
    this.serviceToggle = serviceToggle;
  }

  isEnabled(): boolean {
    return this.hasToken && this.serviceToggle.isServiceEnabledSync(SERVICE_KEY);
  }

  async detectRedditSignals(
    input: RedditSignalSearchInput,
  ): Promise<RedditSignalResult | null> {
    const lg = ensureLogger();

    if (input.subreddits.length === 0) {
      lg.info(
        { companyName: input.companyName },
        "[RedditApify] No subreddits configured, skipping",
      );
      return {
        providerKey: PROVIDER_KEY,
        companyName: input.companyName,
        totalMentions: 0,
        totalActivities: 0,
        subredditsFound: [],
        posts: [],
      };
    }

    const searchKeyword = normalizeCompanyName(input.companyName);

    if (searchKeyword.length < MIN_MATCHABLE_NAME_LENGTH) {
      lg.info(
        { companyName: input.companyName, normalized: searchKeyword },
        "[RedditApify] Company name too short after normalisation, skipping",
      );
      return {
        providerKey: PROVIDER_KEY,
        companyName: input.companyName,
        totalMentions: 0,
        totalActivities: 0,
        subredditsFound: [],
        posts: [],
      };
    }

    const maxPostsPerSubreddit = input.maxPostsPerSubreddit ?? DEFAULT_MAX_ITEMS_PER_SUBREDDIT;
    const maxPostsPerCompany = input.maxPostsPerCompany ?? DEFAULT_MAX_POSTS_PER_COMPANY;

    const allPosts: RedditSignalPostDto[] = [];
    const subredditsWithMatches = new Set<string>();
    let stopped = false;

    const processSubreddit = async (subreddit: string): Promise<void> => {
      if (stopped) return;

      // ── Rate-limit check per subreddit call ──────────────────────
      const limitReached = await this.checkAndIncrementDailyUsage();
      if (limitReached) {
        stopped = true;
        lg.info(
          { companyName: input.companyName, date: utcDateString() },
          "[RedditApify] Daily request limit reached — stopping",
        );
        return;
      }

      try {
        const rawPosts = await this.client.searchSubreddit(
          subreddit,
          searchKeyword,
          maxPostsPerSubreddit,
        );

        if (rawPosts.length > 0) {
          subredditsWithMatches.add(subreddit);
        }

        for (const raw of rawPosts) {
          allPosts.push(mapToDto(raw, subreddit));
        }
      } catch (e) {
        if (e instanceof RedditApifyRateLimitError) {
          stopped = true;
          await this.decrementDailyUsage();
          lg.info(
            { companyName: input.companyName, subreddit },
            "[RedditApify] Provider returned 429 — stopping",
          );
          return;
        }

        wrapRedditApifyError(e);
        // Swallowed — continue to next subreddit
      }
    };

    await runWithConcurrency(input.subreddits, SUBREDDIT_CONCURRENCY, processSubreddit);

    // Cap total posts to avoid bloating
    const cappedPosts = allPosts.slice(0, maxPostsPerCompany);

    return {
      providerKey: PROVIDER_KEY,
      companyName: input.companyName,
      totalMentions: cappedPosts.filter((p) => p.signalType === "mention").length,
      totalActivities: cappedPosts.filter((p) => p.signalType === "activity").length,
      subredditsFound: Array.from(subredditsWithMatches),
      posts: cappedPosts,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Atomically increments today's request counter.
   * Returns `true` if the limit was already reached *before* this call.
   */
  private async checkAndIncrementDailyUsage(): Promise<boolean> {
    const date = utcDateString();

    const updated = await this.prisma.signalProviderDailyUsage.upsert({
      where: { providerKey_date: { providerKey: PROVIDER_KEY, date } },
      create: { providerKey: PROVIDER_KEY, date, requestCount: 1 },
      update: { requestCount: { increment: 1 } },
      select: { requestCount: true },
    });

    return updated.requestCount > DAILY_REQUEST_LIMIT;
  }

  /** Undo an increment when the provider returns a 429. */
  private async decrementDailyUsage(): Promise<void> {
    const date = utcDateString();
    try {
      await this.prisma.signalProviderDailyUsage.updateMany({
        where: { providerKey: PROVIDER_KEY, date, requestCount: { gt: 0 } },
        data: { requestCount: { decrement: 1 } },
      });
    } catch {
      // Best-effort; a slightly off counter is acceptable.
    }
  }

  /**
   * Batch version: search for multiple companies in a single Apify actor run.
   *
   * Uses normalised company names as Apify keywords and re-attributes
   * returned posts via word-boundary matching (+ optional domain matching)
   * to avoid false-positive substring hits.
   */
  async detectRedditSignalsBatch(
    input: RedditSignalBatchInput,
  ): Promise<Map<string, RedditSignalResult>> {
    const lg = ensureLogger();

    if (input.subreddits.length === 0 || input.companies.length === 0) {
      lg.info("[RedditApify] Batch: no subreddits or companies, skipping");
      return new Map();
    }

    // ── Rate-limit check (1 increment for entire batch) ────────────
    const limitReached = await this.checkAndIncrementDailyUsage();
    if (limitReached) {
      lg.info(
        { date: utcDateString(), companyCount: input.companies.length },
        "[RedditApify] Batch: daily request limit reached — stopping",
      );
      return new Map();
    }

    // ── Normalise & deduplicate keywords ───────────────────────────
    const companyMeta = input.companies.map((c) => ({
      original: c,
      normalized: normalizeCompanyName(c.companyName),
      key: c.companyName.trim().toLowerCase(),
    }));

    // Filter out companies whose name is too short after normalisation
    const matchable = companyMeta.filter((c) => {
      if (c.normalized.length < MIN_MATCHABLE_NAME_LENGTH) {
        lg.info(
          { companyName: c.original.companyName, normalized: c.normalized },
          "[RedditApify] Batch: company name too short after normalisation, skipping",
        );
        return false;
      }
      return true;
    });

    // Unique keywords for the Apify actor (deduplicated by lowercased form)
    const seenKeywords = new Set<string>();
    const keywords: string[] = [];
    for (const c of matchable) {
      const lc = c.normalized.toLowerCase();
      if (!seenKeywords.has(lc)) {
        seenKeywords.add(lc);
        keywords.push(c.normalized);
      }
    }

    if (keywords.length === 0) {
      lg.info("[RedditApify] Batch: no matchable company names, skipping");
      return new Map();
    }

    try {
      const rawPosts = await this.client.searchBatch(
        input.subreddits,
        keywords,
        input.maxPostsPerSubreddit ?? DEFAULT_MAX_ITEMS_PER_SUBREDDIT,
      );

      lg.info(
        {
          subredditCount: input.subreddits.length,
          keywordCount: keywords.length,
          companiesTotal: input.companies.length,
          companiesMatchable: matchable.length,
          postsRetrieved: rawPosts.length,
        },
        "[RedditApify] Batch: posts retrieved, mapping to companies",
      );

      // ── Initialise empty results for ALL companies ──────────────
      const resultsByCompany = new Map<string, RedditSignalResult>();

      for (const company of input.companies) {
        const key = company.companyName.trim().toLowerCase();
        resultsByCompany.set(key, {
          providerKey: PROVIDER_KEY,
          companyName: company.companyName,
          totalMentions: 0,
          totalActivities: 0,
          subredditsFound: [],
          posts: [],
        });
      }

      // ── Attribute posts via word-boundary + domain matching ─────
      for (const rawPost of rawPosts) {
        const postText = `${rawPost.title ?? ""} ${rawPost.body ?? ""} ${rawPost.url ?? ""}`.toLowerCase();

        for (const cm of matchable) {
          const nameMatch = matchesCompanyName(postText, cm.normalized.toLowerCase());
          const domainMatch = matchesDomain(postText, cm.original.companyDomain);

          if (!nameMatch && !domainMatch) continue;

          const result = resultsByCompany.get(cm.key);
          if (!result) continue;

          const postDto = mapToDto(rawPost, rawPost.subreddit ?? "unknown");
          result.posts.push(postDto);

          // Track unique subreddits
          if (postDto.subreddit && !result.subredditsFound.includes(postDto.subreddit)) {
            result.subredditsFound.push(postDto.subreddit);
          }
        }
      }

      // ── Finalize results: cap posts, count mentions ─────────────
      const batchMaxPostsPerCompany = input.maxPostsPerCompany ?? DEFAULT_MAX_POSTS_PER_COMPANY;
      for (const result of resultsByCompany.values()) {
        result.posts = result.posts.slice(0, batchMaxPostsPerCompany);
        result.totalMentions = result.posts.filter((p) => p.signalType === "mention").length;
        result.totalActivities = result.posts.filter((p) => p.signalType === "activity").length;

        lg.info(
          {
            companyName: result.companyName,
            mentions: result.totalMentions,
            subreddits: result.subredditsFound.length,
          },
          "[RedditApify] Batch: company result",
        );
      }

      return resultsByCompany;
    } catch (e) {
      if (e instanceof RedditApifyRateLimitError) {
        await this.decrementDailyUsage();
        lg.info(
          { companyCount: input.companies.length },
          "[RedditApify] Batch: provider returned 429 — stopping",
        );
        return new Map();
      }

      wrapRedditApifyError(e);
      // Error swallowed — return empty results
      return new Map();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function mapToDto(raw: RedditScrapedPost, subreddit: string): RedditSignalPostDto {
  const postType = raw.dataType === "comment" ? "comment" : "post";

  return {
    subreddit: raw.subreddit ?? raw.communityName ?? subreddit,
    postType,
    signalType: "mention", // keyword search results are always mentions
    title: raw.title ?? null,
    content: truncate(raw.body, 1000),
    author: raw.username ?? null,
    url: raw.url ?? null,
    score: raw.score ?? null,
    numComments: raw.numberOfComments ?? null,
    createdUtc: raw.parsedCreatedAt ?? raw.createdAt ?? null,
  };
}

function truncate(text: string | null | undefined, maxLen: number): string | null {
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}
