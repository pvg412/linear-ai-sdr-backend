/**
 * Shared DTOs and interface contract for Crunchbase signal providers.
 *
 * Providers are kept fully behind this interface so that no provider
 * implementation detail (brand names, URLs, etc.) ever surfaces to
 * the pipeline layer or the frontend.
 */

/* ------------------------------------------------------------------ */
/*  Input / Output DTOs                                                */
/* ------------------------------------------------------------------ */

/** Company information for Crunchbase lookup. */
export interface CrunchbaseSignalCompanyInfo {
  /** Company name (from lead.company). */
  companyName: string;
  /** Optional company domain (from lead.companyDomain). */
  companyDomain?: string | null;
  /** Lead IDs associated with this company. */
  leadIds: string[];
}

export interface CrunchbaseSignalBatchInput {
  /** Companies to look up in a single batch. */
  companies: CrunchbaseSignalCompanyInfo[];
}

/** Result for a single company's Crunchbase data. */
export interface CrunchbaseSignalResult {
  /** Opaque provider identifier. Never surfaced to the frontend. */
  providerKey: string;
  /** Company name that was queried. */
  companyName: string;
  /** Whether the company was found on Crunchbase. */
  crunchbaseFound: boolean;
  /** Crunchbase permalink (canonical slug). */
  crunchbasePermalink: string | null;

  // ── Funding ─────────────────────────────────────────────────────
  fundingTotalUsd: number | null;
  lastFundingAt: string | null;
  lastFundingType: string | null;
  numFundingRounds: number | null;

  // ── Growth & Heat ───────────────────────────────────────────────
  growthScore: number | null;
  heatScore: number | null;

  // ── Funding Prediction (was "growthPrediction" — fixed to match real API) ──
  fundingPrediction: number | null;
  fundingPrediction0to5: number | null;
  fundingPrediction6to11: number | null;
  fundingPrediction12to24: number | null;
  fundingPrediction24plus: number | null;

  // ── Company Info ────────────────────────────────────────────────
  employeeCountEnum: string | null;
  semrushVisits: number | null;
  shortDescription: string | null;
  foundedOn: string | null;
  operatingStatus: string | null;

  // ── Categories & Industry ──────────────────────────────────────
  /** Comma-separated Crunchbase category names (e.g. "Blockchain,Software"). */
  categories: string | null;

  // ── Investors ──────────────────────────────────────────────────
  numInvestors: number | null;

  // ── Competitors ────────────────────────────────────────────────
  /** Comma-separated top competitor names (up to 5). */
  topCompetitors: string | null;

  // ── Layoffs ────────────────────────────────────────────────────
  hadLayoffs: boolean;

  // ── Tech Stack ─────────────────────────────────────────────────
  /** Comma-separated technology names from BuiltWith. */
  techStack: string | null;

  // ── Predictions ────────────────────────────────────────────────
  ipoPrediction: number | null;
  acquisitionPrediction: number | null;
}

/* ------------------------------------------------------------------ */
/*  Provider interface                                                 */
/* ------------------------------------------------------------------ */

export interface CrunchbaseSignalProvider {
  /** Short opaque key that uniquely identifies this provider. */
  readonly key: string;

  /** Returns false when the provider is misconfigured (e.g. missing API key). */
  isEnabled(): boolean;

  /**
   * Batch lookup: queries the provider for Crunchbase data for multiple companies.
   *
   * Returns a Map keyed by normalised company name (lowercased trim).
   * Companies not found will have `crunchbaseFound: false` in their result.
   *
   * Returns `null` when the daily rate limit has been reached — the caller
   * must skip this provider silently without failing the pipeline.
   *
   * May throw for unexpected errors; callers are responsible for catching
   * and logging those without re-throwing (graceful degradation).
   */
  detectCrunchbaseSignalsBatch(
    input: CrunchbaseSignalBatchInput,
  ): Promise<Map<string, CrunchbaseSignalResult> | null>;
}
