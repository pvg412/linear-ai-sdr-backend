/**
 * TypeScript interfaces for the Hirebase API (v2).
 *
 * Docs: https://www.hirebase.org/docs
 * Auth: X-API-Key header
 * Base: https://api.hirebase.org/
 */

// ── Request ──────────────────────────────────────────────────────────

export interface HirebaseSearchRequest {
  /** Filter by exact company name. */
  company_name?: string;
  /** How many days back to look (e.g. 90 = last 90 days). */
  days_ago?: number;
  /** Field to sort by. */
  sort_by?: "relevance" | "date posted" | "salary";
  /** Sort direction. */
  sort_order?: "asc" | "desc";
  /** Page number (1-indexed). */
  page?: number;
  /** Results per page (default: 10). */
  limit?: number;
  /**
   * Filter out recruiter-agency repostings.
   * Pass "true" to hide them.
   */
  hide_recruiting_agencies?: "true" | "false";
}

// ── Response ─────────────────────────────────────────────────────────

export interface HirebaseJobLocation {
  city?: string;
  region?: string;
  country?: string;
}

export interface HirebaseSalaryRange {
  min?: number;
  max?: number;
  currency?: string;
  period?: string;
}

export interface HirebaseJob {
  _id: string;
  job_title?: string;
  job_categories?: string[];
  job_type?: string;
  location_type?: string;
  locations?: HirebaseJobLocation[];
  salary_range?: HirebaseSalaryRange | null;
  date_posted?: string;
  requirements_summary?: string;
  skills?: string[];
  technologies?: string[];
  experience?: string;
  team?: string;
  company_name?: string;
  company_slug?: string;
}

export interface HirebaseSearchResponse {
  jobs: HirebaseJob[];
  total_count?: number;
  company_count?: number;
  page?: number;
  limit?: number;
  total_pages?: number;
}

// ── Error ─────────────────────────────────────────────────────────────

export interface HirebaseErrorResponse {
  error?: string;
  message?: string;
  details?: {
    retry_after?: number;
    [key: string]: unknown;
  };
}
