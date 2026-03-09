import { injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { ensureLogger } from "@/infra/observability";
import type { ServiceToggleService } from "@/modules/admin/services/service-toggle.service";

import type {
  CrunchbaseSignalProvider,
  CrunchbaseSignalBatchInput,
  CrunchbaseSignalResult,
  CrunchbaseSignalCompanyInfo,
} from "@/capabilities/crunchbase-signals/crunchbase-signal-provider.dto";
import { generateCandidateSlugs } from "@/capabilities/crunchbase-signals/utils/normalize-company-name";
import { CrunchbaseApifyClient } from "./crunchbase-apify.client";
import type { CrunchbaseCompanyResult } from "./crunchbase-apify.schemas";
import {
  CrunchbaseApifyRateLimitError,
  wrapCrunchbaseApifyError,
} from "./crunchbase-apify.errors";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Opaque key used in DB records. Never shown to the frontend. */
const PROVIDER_KEY = "crunchbase-apify";

/** ServiceToggle key for enabling/disabling the Crunchbase signal globally. */
const SERVICE_KEY = "crunchbase-scraper";

/**
 * Maximum number of requests per UTC calendar day.
 * Conservative default — adjust based on Apify plan limits.
 */
const DAILY_REQUEST_LIMIT = 200;

/** Maximum number of competitors to extract from org_similarity_list. */
const MAX_COMPETITORS = 5;

/** Maximum number of technologies to extract from builtwith_tech_used_list. */
const MAX_TECH_ITEMS = 15;

/** Number of companies to process in parallel (Apify actor calls). */
const COMPANY_CONCURRENCY = 3;

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Runs async tasks with a concurrency limit (worker pool pattern).
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items];
  
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) {
        const result = await fn(item);
        results.push(result);
      }
    }
  });
  
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ */
/*  Provider implementation                                            */
/* ------------------------------------------------------------------ */

/**
 * Crunchbase signal provider backed by the
 * `pratikdani/crunchbase-companies-bulk-scraper-no-cookies` Apify actor.
 *
 * Strategy:
 * 1. For each company, generate candidate Crunchbase slugs (multi-level matching)
 * 2. Batch ALL candidate URLs into a single Apify actor call
 * 3. Match results back to companies by slug/permalink
 * 4. Companies not found → crunchbaseFound: false
 *
 * Daily request quota is tracked in the `SignalProviderDailyUsage` table.
 */
@injectable()
export class CrunchbaseApifyProvider implements CrunchbaseSignalProvider {
  readonly key = PROVIDER_KEY;

  private readonly client: CrunchbaseApifyClient;
  private readonly prisma = getPrisma();
  private readonly serviceToggle: ServiceToggleService;
  private readonly hasToken: boolean;

  constructor(apifyToken: string, serviceToggle: ServiceToggleService) {
    this.hasToken = Boolean(apifyToken);
    this.client = new CrunchbaseApifyClient();
    this.serviceToggle = serviceToggle;
  }

  isEnabled(): boolean {
    return this.hasToken && this.serviceToggle.isServiceEnabledSync(SERVICE_KEY);
  }

  async detectCrunchbaseSignalsBatch(
    input: CrunchbaseSignalBatchInput,
  ): Promise<Map<string, CrunchbaseSignalResult> | null> {
    const lg = ensureLogger();

    if (input.companies.length === 0) {
      return new Map();
    }

    lg.info(
      { companies: input.companies.length },
      "[CrunchbaseApify] Starting per-company lookup",
    );

    // ── Process each company individually with concurrency ──────────
    const processCompany = async (
      company: CrunchbaseSignalCompanyInfo,
    ): Promise<{ key: string; result: CrunchbaseSignalResult }> => {
      const key = company.companyName.trim().toLowerCase();

      // Check rate limit PER company (each company = 1 actor call)
      const canProceed = await this.tryIncrementDailyUsage();
      if (!canProceed) {
        lg.info(
          { companyName: company.companyName },
          "[CrunchbaseApify] Daily request limit reached, skipping this company",
        );
        return { key, result: buildNotFoundResult(company.companyName) };
      }

      // Generate candidate slugs for this company
      const candidateSlugs = generateCandidateSlugs({
        companyName: company.companyName,
        companyDomain: company.companyDomain,
      });

      if (candidateSlugs.length === 0) {
        lg.warn(
          { companyName: company.companyName },
          "[CrunchbaseApify] No candidate slugs generated",
        );
        return { key, result: buildNotFoundResult(company.companyName) };
      }

      // Call Apify actor for this company's slugs only
      try {
        const rawResult = await this.client.scrapeCompany(candidateSlugs);
        
        if (rawResult) {
          lg.info(
            { companyName: company.companyName, permalink: rawResult.identifier?.permalink },
            "[CrunchbaseApify] Company found",
          );
          return { key, result: mapToResult(company.companyName, rawResult) };
        } else {
          lg.info(
            { companyName: company.companyName, slugsTried: candidateSlugs.length },
            "[CrunchbaseApify] Company not found",
          );
          return { key, result: buildNotFoundResult(company.companyName) };
        }
      } catch (err) {
        try {
          wrapCrunchbaseApifyError(err);
        } catch (wrapped) {
          if (wrapped instanceof CrunchbaseApifyRateLimitError) {
            lg.info(
              { companyName: company.companyName },
              "[CrunchbaseApify] Rate limited by Apify, marking as not found",
            );
            return { key, result: buildNotFoundResult(company.companyName) };
          }
          throw wrapped;
        }
        // Error was swallowed by wrapCrunchbaseApifyError
        lg.warn(
          { companyName: company.companyName, err },
          "[CrunchbaseApify] Scrape failed, marking as not found",
        );
        return { key, result: buildNotFoundResult(company.companyName) };
      }
    };

    // Run with concurrency limit to avoid overwhelming Apify
    const results = await runWithConcurrency(
      input.companies,
      COMPANY_CONCURRENCY,
      processCompany,
    );

    // ── Build results map ────────────────────────────────────────────
    const resultsMap = new Map<string, CrunchbaseSignalResult>();
    for (const { key, result } of results) {
      resultsMap.set(key, result);
    }

    // ── Log matching quality ─────────────────────────────────────────
    const found = results.filter((r) => r.result.crunchbaseFound).length;
    const total = input.companies.length;
    const matchRate = total > 0 ? Math.round((found / total) * 100) : 0;

    lg.info(
      { found, total, matchRate: `${matchRate}%`, providerKey: PROVIDER_KEY },
      `[CrunchbaseApify] Per-company lookup complete: found ${found}/${total} companies (${matchRate}% match rate)`,
    );

    return resultsMap;
  }

  /* ---------------------------------------------------------------- */
  /*  Rate limiting                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Atomically increment the daily usage counter. Returns `true` if
   * the provider is within its daily limit, `false` otherwise.
   */
  private async tryIncrementDailyUsage(): Promise<boolean> {
    const date = utcDateString();

    const record = await this.prisma.signalProviderDailyUsage.upsert({
      where: {
        providerKey_date: { providerKey: PROVIDER_KEY, date },
      },
      create: {
        providerKey: PROVIDER_KEY,
        date,
        requestCount: 1,
      },
      update: {
        requestCount: { increment: 1 },
      },
    });

    if (record.requestCount > DAILY_REQUEST_LIMIT) {
      // Rolled past limit — decrement back (best-effort)
      await this.prisma.signalProviderDailyUsage.update({
        where: { id: record.id },
        data: { requestCount: { decrement: 1 } },
      }).catch(() => { /* ignore */ });
      return false;
    }

    return true;
  }
}

/* ------------------------------------------------------------------ */
/*  Mapping helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build a "not found" result for companies that were not matched.
 */
function buildNotFoundResult(companyName: string): CrunchbaseSignalResult {
  return {
    providerKey: PROVIDER_KEY,
    companyName,
    crunchbaseFound: false,
    crunchbasePermalink: null,
    fundingTotalUsd: null,
    lastFundingAt: null,
    lastFundingType: null,
    numFundingRounds: null,
    growthScore: null,
    heatScore: null,
    fundingPrediction: null,
    fundingPrediction0to5: null,
    fundingPrediction6to11: null,
    fundingPrediction12to24: null,
    fundingPrediction24plus: null,
    employeeCountEnum: null,
    semrushVisits: null,
    shortDescription: null,
    foundedOn: null,
    operatingStatus: null,
    categories: null,
    numInvestors: null,
    topCompetitors: null,
    hadLayoffs: false,
    techStack: null,
    ipoPrediction: null,
    acquisitionPrediction: null,
  };
}

/**
 * Map a raw Crunchbase actor result to the provider-agnostic DTO.
 */
function mapToResult(
  companyName: string,
  raw: CrunchbaseCompanyResult,
): CrunchbaseSignalResult {
  const funding = raw.funding_rounds_summary;
  const growth = raw.growth_and_heat;
  const prediction = raw.funding_prediction;
  const about = raw.company_about_fields2;
  const semrush = raw.semrush_summary;
  const desc = raw.about_short_description;
  const overview = raw.overview_fields_extended;

  // ── Funding prediction + timeseries ──────────────────────────────
  const firstPrediction = Array.isArray(prediction) && prediction.length > 0
    ? prediction[0]
    : null;
  const timeseries = firstPrediction?.probability_score_timeseries;

  // ── Categories from org_similarity_list.source_categories ────────
  const categories = extractCategories(raw);

  // ── Top competitors from org_similarity_list ──────────────────────
  const topCompetitors = extractCompetitors(raw);

  // ── Tech stack from builtwith_tech_used_list ──────────────────────
  const techStack = extractTechStack(raw);

  // ── Layoffs ───────────────────────────────────────────────────────
  const hadLayoffs = Array.isArray(raw.layoff_list) && raw.layoff_list.length > 0;

  // ── IPO / Acquisition predictions ─────────────────────────────────
  const ipoPrediction = Array.isArray(raw.ipo_prediction) && raw.ipo_prediction.length > 0
    ? (raw.ipo_prediction[0]?.probability_score ?? null)
    : null;
  const acquisitionPrediction = Array.isArray(raw.acquisition_prediction) && raw.acquisition_prediction.length > 0
    ? (raw.acquisition_prediction[0]?.probability_score ?? null)
    : null;

  return {
    providerKey: PROVIDER_KEY,
    companyName,
    crunchbaseFound: true,
    crunchbasePermalink: raw.identifier?.permalink ?? null,

    fundingTotalUsd: funding?.funding_total?.value_usd ?? null,
    lastFundingAt: funding?.last_funding_at ?? null,
    lastFundingType: funding?.last_funding_type ?? null,
    numFundingRounds: funding?.num_funding_rounds ?? null,

    growthScore: growth?.growth_score ?? null,
    heatScore: growth?.heat_score ?? null,

    fundingPrediction: firstPrediction?.probability_score ?? null,
    fundingPrediction0to5: timeseries?.months_00_to_05 ?? null,
    fundingPrediction6to11: timeseries?.months_06_to_11 ?? null,
    fundingPrediction12to24: timeseries?.months_12_to_24 ?? null,
    fundingPrediction24plus: timeseries?.months_24_plus ?? null,

    employeeCountEnum: about?.num_employees_enum ?? null,
    semrushVisits: semrush?.semrush_visits_latest_month ?? null,
    shortDescription: desc?.short_description ?? null,
    foundedOn: overview?.founded_on ?? null,
    operatingStatus: overview?.operating_status ?? null,

    categories,
    numInvestors: raw.investors_summary?.num_investors ?? null,
    topCompetitors,
    hadLayoffs,
    techStack,
    ipoPrediction,
    acquisitionPrediction,
  };
}

/**
 * Extract unique category names from the first org_similarity_list entry's
 * `source_categories`. These are the categories of the queried company itself.
 */
function extractCategories(raw: CrunchbaseCompanyResult): string | null {
  const list = raw.org_similarity_list;
  if (!Array.isArray(list) || list.length === 0) return null;

  // source_categories is the same for all entries (it's our company's categories)
  const first = list[0];
  const cats = first?.source_categories;
  if (!Array.isArray(cats) || cats.length === 0) return null;

  const names = cats
    .map((c) => c?.value)
    .filter((v): v is string => Boolean(v));

  return names.length > 0 ? names.join(",") : null;
}

/**
 * Extract top competitor names from org_similarity_list (sorted by score desc).
 * Returns up to MAX_COMPETITORS names, comma-separated.
 */
function extractCompetitors(raw: CrunchbaseCompanyResult): string | null {
  const list = raw.org_similarity_list;
  if (!Array.isArray(list) || list.length === 0) return null;

  const competitors = list
    .filter((item) => item?.target?.value)
    .sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0))
    .slice(0, MAX_COMPETITORS)
    .map((item) => item!.target!.value!);

  return competitors.length > 0 ? competitors.join(",") : null;
}

/**
 * Extract technology names from builtwith_tech_used_list.
 * Returns up to MAX_TECH_ITEMS names, comma-separated.
 */
function extractTechStack(raw: CrunchbaseCompanyResult): string | null {
  const list = raw.builtwith_tech_used_list;
  if (!Array.isArray(list) || list.length === 0) return null;

  const techs = list
    .slice(0, MAX_TECH_ITEMS)
    .map((item) => item?.identifier?.value)
    .filter((v): v is string => Boolean(v));

  return techs.length > 0 ? techs.join(",") : null;
}
