import { injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { ensureLogger } from "@/infra/observability";
import type { ServiceToggleService } from "@/modules/admin/services/service-toggle.service";

import type {
  RedditSignalProvider,
  RedditSignalSearchInput,
  RedditSignalResult,
  RedditSignalPostDto,
} from "@/capabilities/reddit-signals/reddit-signal-provider.dto";
import { RedditApifyClient } from "./reddit-apify.client";
import {
  RedditApifyRateLimitError,
  wrapRedditApifyError,
} from "./reddit-apify.errors";
import type { RedditScrapedPost } from "./reddit-apify.schemas";

/** Opaque key used in DB records. Never shown to the frontend. */
const PROVIDER_KEY = "reddit-apify";

/** ServiceToggle key for enabling/disabling the Reddit signal globally. */
const SERVICE_KEY = "reddit-scraper";

/**
 * Maximum number of requests per UTC calendar day.
 * Conservative default — adjust based on Apify plan limits.
 */
const DAILY_REQUEST_LIMIT = 500;

/** Maximum number of items to retrieve per subreddit search. */
const MAX_ITEMS_PER_SUBREDDIT = 25;

/** Maximum number of posts to keep per company across all subreddits. */
const MAX_POSTS_PER_COMPANY = 50;

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
          input.companyName,
          MAX_ITEMS_PER_SUBREDDIT,
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
    const cappedPosts = allPosts.slice(0, MAX_POSTS_PER_COMPANY);

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
