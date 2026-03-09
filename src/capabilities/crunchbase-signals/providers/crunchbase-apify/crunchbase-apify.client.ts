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
   * Scrape Crunchbase data for a SINGLE company's candidate slugs.
   * 
   * This method is more resilient than batching all companies together — if one
   * company's slugs are invalid (causing the actor to crash), it doesn't affect
   * other companies.
   * 
   * @param slugs - Array of candidate slugs for ONE company (e.g. ["gigradar", "gigradar-io", "gig-radar"])
   * @returns The first matching result, or null if no slug resolved successfully
   */
  async scrapeCompany(slugs: string[]): Promise<CrunchbaseCompanyResult | null> {
    if (slugs.length === 0) return null;

    const client = this.getClient();
    const lg = ensureLogger();

    // Build the URL list from candidate slugs
    const urls = slugs.map((slug) => `${CRUNCHBASE_ORG_BASE}${slug}`);

    const input = {
      urls,
    };

    const waitSecs = 30; // Shorter timeout for single-company runs

    lg.info(
      { slugCount: slugs.length, waitSecs },
      "Crunchbase single-company scrape starting",
    );

    try {
      const run = await withRetry(
        () => client.actor(this.actorId).call(input, { waitSecs }),
        {
          maxAttempts: MAX_RETRIES,
          backoffMs: RETRY_BACKOFF_MS,
          label: `crunchbase-single:${slugs[0]}`,
        },
      );

      if (!run.defaultDatasetId) {
        lg.warn({ slugs }, "Crunchbase scraper returned no dataset");
        return null;
      }

      const { items } = await client.dataset(run.defaultDatasetId).listItems({
        limit: slugs.length * 2,
      });

      if (!items || items.length === 0) {
        return null;
      }

      // Parse and return the FIRST valid result (candidate slugs are ordered by confidence)
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if ("message" in item && !("identifier" in item) && !("url" in item)) continue;

        try {
          const parsed = CrunchbaseCompanyResultSchema.parse(item);
          lg.info({ permalink: parsed.identifier?.permalink }, "Crunchbase single-company scrape found match");
          return parsed;
        } catch (err) {
          lg.warn({ err }, "Failed to parse Crunchbase company result");
        }
      }

      return null;
    } catch (err) {
      lg.warn({ err, slugs }, "Crunchbase single-company scrape failed");
      throw err; // Let caller handle error wrapping
    }
  }

  /**
   * Scrape Crunchbase data for multiple company slugs in a single actor run.
   *
   * @deprecated Use scrapeCompany() for per-company resilience instead of batching all companies
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
 * Extract the slug from a Crunchbase result.
 * 
 * CRITICAL: Prioritize the INPUT URL (the slug WE sent) over the permalink
 * (Crunchbase's canonical slug). This ensures we can match results back to
 * companies via the slugToCompanyKey map which is keyed by our input slugs.
 * 
 * If we sent "gigradar" but Crunchbase returned permalink "gigradar-io",
 * we MUST return "gigradar" here so the provider can find it in slugToCompanyKey.
 */
function extractSlugFromResult(result: CrunchbaseCompanyResult): string | null {
  // Primary: extract the slug from the input URL (this is OUR slug)
  if (result.url) {
    const match = result.url.match(/\/organization\/([^/?#]+)/);
    if (match?.[1]) return match[1].toLowerCase();
  }

  // Fallback: use permalink if URL is missing (shouldn't happen)
  const permalink = result.identifier?.permalink;
  if (permalink) return permalink.toLowerCase();

  return null;
}
