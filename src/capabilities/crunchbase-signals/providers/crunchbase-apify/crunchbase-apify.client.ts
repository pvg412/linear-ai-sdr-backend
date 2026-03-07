import { ApifyClient } from "apify-client";

import { loadEnv } from "@/config/env";
import { UserFacingError } from "@/infra/userFacingError";
import { ensureLogger } from "@/infra/observability";

import {
  CrunchbaseCompanyResultSchema,
  type CrunchbaseCompanyResult,
} from "./crunchbase-apify.schemas";

const DEFAULT_ACTOR_ID = "pratikdani/crunchbase-companies-bulk-scraper-no-cookies";
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 2_000;
const WAIT_SECS = 60;

const CRUNCHBASE_ORG_BASE = "https://www.crunchbase.com/organization/";

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
          "Crunchbase Apify call failed, retrying",
        );
        await sleep(options.backoffMs * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
}

/**
 * Thin client for the `pratikdani/crunchbase-companies-bulk-scraper-no-cookies` Apify actor.
 *
 * Uses the synchronous `.call()` pattern (waits for the actor to finish).
 * Accepts an array of Crunchbase organisation URLs and returns parsed company data.
 */
export class CrunchbaseApifyClient {
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
          userMessage: "Crunchbase scraper service is not configured",
        });
      }
      this.client = new ApifyClient({ token: env.APIFY_TOKEN });
    }
    return this.client;
  }

  /**
   * Scrape Crunchbase data for multiple company slugs in a single actor run.
   *
   * @param slugs - Array of Crunchbase organisation slugs (e.g. "gigradar-io")
   * @returns Map of slug -> parsed company result. Slugs not found are absent from the map.
   */
  async scrapeCompanies(slugs: string[]): Promise<Map<string, CrunchbaseCompanyResult>> {
    if (slugs.length === 0) return new Map();

    const client = this.getClient();
    const lg = ensureLogger();

    // Build the URL list from slugs
    const urls = slugs.map((slug) => `${CRUNCHBASE_ORG_BASE}${slug}`);

    const input = {
      urls,
    };

    lg.info(
      { slugCount: slugs.length, waitSecs: WAIT_SECS },
      "Crunchbase batch scrape starting",
    );

    const run = await withRetry(
      () => client.actor(this.actorId).call(input, { waitSecs: WAIT_SECS }),
      {
        maxAttempts: MAX_RETRIES,
        backoffMs: RETRY_BACKOFF_MS,
        label: `crunchbase-batch:${slugs.length}`,
      },
    );

    if (!run.defaultDatasetId) {
      lg.warn({ slugCount: slugs.length }, "Crunchbase scraper returned no dataset");
      return new Map();
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems({
      limit: slugs.length * 2, // Some buffer for unexpected duplicates
    });

    if (!items || items.length === 0) {
      return new Map();
    }

    const results = new Map<string, CrunchbaseCompanyResult>();

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      // Skip info/error messages from the actor
      if ("message" in item && !("identifier" in item) && !("url" in item)) continue;

      try {
        const parsed = CrunchbaseCompanyResultSchema.parse(item);

        // Determine which slug this result belongs to
        const slug = extractSlugFromResult(parsed);
        if (slug && !results.has(slug)) {
          results.set(slug, parsed);
        }
      } catch (err) {
        lg.warn({ err }, "Failed to parse Crunchbase company result");
      }
    }

    lg.info(
      { requested: slugs.length, found: results.size },
      "Crunchbase batch scrape completed",
    );

    return results;
  }
}

/**
 * Extract the slug from a Crunchbase result, trying permalink first,
 * then falling back to parsing the URL.
 */
function extractSlugFromResult(result: CrunchbaseCompanyResult): string | null {
  // Try permalink from identifier
  const permalink = result.identifier?.permalink;
  if (permalink) return permalink.toLowerCase();

  // Fallback: extract slug from the input URL
  if (result.url) {
    const match = result.url.match(/\/organization\/([^/?#]+)/);
    if (match?.[1]) return match[1].toLowerCase();
  }

  return null;
}
