/**
 * Shared DTOs and interface contract for hiring-signal providers.
 *
 * Providers are kept fully behind this interface so that no provider
 * implementation detail (brand names, URLs, etc.) ever surfaces to
 * the pipeline layer or the frontend.
 */

export interface SignalSearchInput {
  /** Company name to search for (from lead.company). */
  companyName: string;
  /** Optional company domain hint (from lead.companyDomain). */
  companyDomain?: string | null;
  /** Lead ID this search is performed on behalf of. */
  leadId: string;
}

export interface SignalJobLocationDto {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

export interface SignalJobDto {
  /** External ID from the provider (e.g. Hirebase _id). */
  externalId?: string | null;
  jobTitle?: string | null;
  team?: string | null;
  /** e.g. "Full Time", "Part Time", "Contract" */
  jobType?: string | null;
  /** e.g. "In-Person", "Remote", "Hybrid" */
  locationType?: string | null;
  /** ISO date string, e.g. "2025-12-05" */
  datePosted?: string | null;
  companyName?: string | null;
  companySlug?: string | null;
  requirementsSummary?: string | null;
  skills: string[];
  technologies: string[];
  jobCategories: string[];
  locations: SignalJobLocationDto[];
}

export interface HiringSignalResult {
  /** Opaque provider identifier, e.g. "hirebase". Never surfaced to the frontend. */
  providerKey: string;
  /** Normalised company name as returned/used by the provider. */
  companyName: string;
  /** Total number of open job listings found for this company. */
  openJobCount: number;
  /** Deduplicated set of hiring departments / job categories. */
  departments: string[];
  /** Sample of job titles (up to 10), ordered by recency. */
  topJobTitles: string[];
  /** Normalised job listings returned by the provider. */
  jobs: SignalJobDto[];
}

export interface SignalProvider {
  /** Short opaque key that uniquely identifies this provider. */
  readonly key: string;

  /** Returns false when the provider is misconfigured (e.g. missing API key). */
  isEnabled(): boolean;

  /**
   * Queries the provider for hiring signals at the given company.
   *
   * Returns `null` when the daily rate limit has been reached — the caller
   * must skip this provider silently without failing the pipeline.
   *
   * May throw for unexpected errors; callers are responsible for catching
   * and logging those without re-throwing (graceful degradation).
   */
  detectHiringSignals(
    input: SignalSearchInput,
  ): Promise<HiringSignalResult | null>;
}
