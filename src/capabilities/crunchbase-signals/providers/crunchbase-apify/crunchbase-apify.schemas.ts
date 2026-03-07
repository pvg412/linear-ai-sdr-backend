import { z } from "zod";

/**
 * Zod schema for the Crunchbase bulk scraper actor response.
 *
 * Actor: `pratikdani/crunchbase-companies-bulk-scraper-no-cookies`
 *
 * The response is deeply nested; we extract only the fields we persist.
 * All fields are optional because individual companies may have partial data.
 *
 * IMPORTANT — field naming follows the *real* API response structure:
 *   - `funding_prediction` (NOT `growth_prediction`)
 *   - `identifier.permalink` is nested inside an `identifier` object
 *   - `about_short_description` contains `{ short_description: "..." }`
 */

// ── Funding ─────────────────────────────────────────────────────────

const FundingRoundsSummarySchema = z.object({
  funding_total: z.object({
    value_usd: z.number().nullable().optional(),
  }).nullable().optional(),
  last_funding_at: z.string().nullable().optional(),
  last_funding_type: z.string().nullable().optional(),
  num_funding_rounds: z.number().nullable().optional(),
}).nullable().optional();

// ── Growth & Heat ───────────────────────────────────────────────────

const GrowthAndHeatSchema = z.object({
  growth_score: z.number().nullable().optional(),
  heat_score: z.number().nullable().optional(),
}).nullable().optional();

// ── Funding Prediction (real API field name, NOT "growth_prediction") ──

const FundingPredictionTimeseriesSchema = z.object({
  months_00_to_05: z.number().nullable().optional(),
  months_06_to_11: z.number().nullable().optional(),
  months_12_to_24: z.number().nullable().optional(),
  months_24_plus: z.number().nullable().optional(),
}).nullable().optional();

const FundingPredictionItemSchema = z.object({
  probability_score: z.number().nullable().optional(),
  probability_score_timeseries: FundingPredictionTimeseriesSchema,
}).nullable().optional();

// ── Company Info ────────────────────────────────────────────────────

const CompanyAboutFields2Schema = z.object({
  num_employees_enum: z.string().nullable().optional(),
}).nullable().optional();

const SemrushSummarySchema = z.object({
  semrush_visits_latest_month: z.number().nullable().optional(),
}).nullable().optional();

const AboutShortDescriptionSchema = z.object({
  short_description: z.string().nullable().optional(),
}).nullable().optional();

const OverviewFieldsExtendedSchema = z.object({
  founded_on: z.string().nullable().optional(),
  operating_status: z.string().nullable().optional(),
}).nullable().optional();

// ── Investors ───────────────────────────────────────────────────────

const InvestorsSummarySchema = z.object({
  num_investors: z.number().nullable().optional(),
}).nullable().optional();

// ── Competitors (org_similarity_list) ───────────────────────────────

const OrgSimilarityItemSchema = z.object({
  score: z.number().nullable().optional(),
  source_categories: z.array(z.object({
    value: z.string().nullable().optional(),
  })).nullable().optional(),
  target: z.object({
    value: z.string().nullable().optional(),
  }).nullable().optional(),
}).nullable().optional();

// ── Tech Stack (builtwith_tech_used_list) ───────────────────────────

const BuiltWithTechItemSchema = z.object({
  identifier: z.object({
    value: z.string().nullable().optional(),
  }).nullable().optional(),
}).nullable().optional();

// ── Predictions ────────────────────────────────────────────────────

const IpoPredictionItemSchema = z.object({
  probability_score: z.number().nullable().optional(),
}).nullable().optional();

const AcquisitionPredictionItemSchema = z.object({
  probability_score: z.number().nullable().optional(),
}).nullable().optional();

// ── Layoffs ─────────────────────────────────────────────────────────
// layoff_list is simply an array of objects — we only need to know if non-empty

const LayoffItemSchema = z.object({}).passthrough().nullable().optional();

/* ------------------------------------------------------------------ */
/*  Full company result schema                                         */
/* ------------------------------------------------------------------ */

/**
 * Full schema for a single Crunchbase company result item.
 *
 * The actor returns an array of these objects in its dataset.
 * We use `.passthrough()` so unknown extra fields don't cause validation errors.
 */
export const CrunchbaseCompanyResultSchema = z.object({
  /** The input URL that was scraped — used to match results back to companies. */
  url: z.string().optional(),

  /** Crunchbase permalink (e.g. "gigradar-io") — the canonical identifier. */
  identifier: z.object({
    permalink: z.string().nullable().optional(),
  }).nullable().optional(),

  // ── Funding ─────────────────────────────────────────────────────
  funding_rounds_summary: FundingRoundsSummarySchema,

  // ── Growth & Heat ───────────────────────────────────────────────
  growth_and_heat: GrowthAndHeatSchema,

  // ── Funding Prediction (was incorrectly "growth_prediction") ────
  funding_prediction: z.array(FundingPredictionItemSchema).nullable().optional(),

  // ── Company Info ────────────────────────────────────────────────
  company_about_fields2: CompanyAboutFields2Schema,
  semrush_summary: SemrushSummarySchema,
  about_short_description: AboutShortDescriptionSchema,
  overview_fields_extended: OverviewFieldsExtendedSchema,

  // ── Investors ───────────────────────────────────────────────────
  investors_summary: InvestorsSummarySchema,

  // ── Competitors ─────────────────────────────────────────────────
  org_similarity_list: z.array(OrgSimilarityItemSchema).nullable().optional(),

  // ── Tech Stack ──────────────────────────────────────────────────
  builtwith_tech_used_list: z.array(BuiltWithTechItemSchema).nullable().optional(),

  // ── Predictions ─────────────────────────────────────────────────
  ipo_prediction: z.array(IpoPredictionItemSchema).nullable().optional(),
  acquisition_prediction: z.array(AcquisitionPredictionItemSchema).nullable().optional(),

  // ── Layoffs ─────────────────────────────────────────────────────
  layoff_list: z.array(LayoffItemSchema).nullable().optional(),
}).passthrough();

export type CrunchbaseCompanyResult = z.infer<typeof CrunchbaseCompanyResultSchema>;
