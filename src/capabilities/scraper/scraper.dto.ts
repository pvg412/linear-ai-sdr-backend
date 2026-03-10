import { LeadProvider } from "@prisma/client";
import z from "zod";

import { CompanySizeSchema } from "../lead-db/lead-db.dto";
import { NormalizedLead } from "../shared/leadValidate";

// -------------------------
// Apify schemas (allow extra fields via proto ScraperQuery.extra)
// -------------------------

const S = z.string().trim().min(1);

const YearsBucketIdSchema = z.enum(["1", "2", "3", "4", "5"]);
const AutoSegLevelSchema = z.enum([
  "default",
  "country",
  "state",
  "seniority_level",
  "industry",
]);
const ApifyDedupModeSchema = z.enum([
  "off",
  "insert_ids",
  "insert_profiles",
  "read_only",
]);
const ProfileScraperModeSchema = z.enum([
  "Short",
  "Full",
  "Full + email search",
]);

export const ApifyScraperQuerySchema = z.looseObject({
  limit: z.number().int().positive(),

  // keep base fields for UI stability
  industry: S.optional(),
  titles: z.array(S).default([]),
  locations: z.array(S).default([]),
  companySize: CompanySizeSchema.optional(),
  companyKeywords: z.array(S).optional(),

  // Apify-specific
  searchQuery: S.max(300).optional(),

  currentCompanies: z.array(S).optional(),
  pastCompanies: z.array(S).optional(),
  schools: z.array(S).optional(),
  pastJobTitles: z.array(S).optional(),

  excludeLocations: z.array(S).optional(),
  excludeCurrentCompanies: z.array(S).optional(),
  excludePastCompanies: z.array(S).optional(),
  excludeSchools: z.array(S).optional(),
  excludeCurrentJobTitles: z.array(S).optional(),
  excludePastJobTitles: z.array(S).optional(),

  industryIds: z.array(S).optional(),
  excludeIndustryIds: z.array(S).optional(),

  companyHeadcount: z.array(z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I"])).optional(),

  seniorityLevelIds: z.array(S).optional(),
  excludeSeniorityLevelIds: z.array(S).optional(),

  functionIds: z.array(S).optional(),
  excludeFunctionIds: z.array(S).optional(),

  yearsOfExperienceIds: z.array(YearsBucketIdSchema).optional(),
  yearsAtCurrentCompanyIds: z.array(YearsBucketIdSchema).optional(),

  firstNames: z.array(S).optional(),
  lastNames: z.array(S).optional(),
  profileLanguages: z.array(S).optional(),
  recentlyChangedJobs: z.boolean().optional(),

  startPage: z.number().int().min(1).max(100).optional(),
  takePages: z.number().int().min(0).max(100).optional(),

  autoQuerySegmentation: z.boolean().optional(),
  autoQuerySegmentationLevels: z.array(AutoSegLevelSchema).optional(),
  autoQuerySegmentationTargetCountries: z
    .array(z.string().trim().min(2).max(2))
    .optional(),

  // dedupe flags (no mongo secrets here)
  dedupe: z.boolean().optional(),
  profileDeduplicationMode: ApifyDedupModeSchema.optional(),

  profileScraperMode: ProfileScraperModeSchema.optional(),

  // post-filtering (passed to Apify actor)
  postFilteringMongoDbQuery: z.record(z.string(), z.unknown()).optional(),
  postFilteringMongoDbAggregation: z
    .array(z.record(z.string(), z.unknown()))
    .optional(),
});

export type ApifyScraperQuery = z.infer<typeof ApifyScraperQuerySchema>;

export const ScraperCityScrapeQuerySchema = z.object({
  apolloUrl: z.string().trim().min(1),
  limit: z.number().int().positive(),
});

export type ScraperCityScraperQuery = z.infer<
  typeof ScraperCityScrapeQuerySchema
>;

// Schema registry for provider-specific scrape query schemas
// Open for extension (add new providers), closed for modification
const scraperQuerySchemaRegistry = new Map<LeadProvider, z.ZodType>([
  [LeadProvider.SCRAPER_CITY, ScraperCityScrapeQuerySchema],
  [LeadProvider.APIFY, ApifyScraperQuerySchema],
]);

/**
 * Register a scrape query schema for a provider.
 * Use this to extend the registry without modifying existing code.
 */
export function registerScrapeQuerySchema(
  provider: LeadProvider,
  schema: z.ZodType,
): void {
  scraperQuerySchemaRegistry.set(provider, schema);
}

/**
 * Get the scrape query schema for a provider.
 * Returns ScraperCityScrapeQuerySchema as default for unknown providers.
 */
export function getScrapeQuerySchemaForProvider(
  provider: LeadProvider,
): z.ZodType {
  return scraperQuerySchemaRegistry.get(provider) ?? ScraperCityScrapeQuerySchema;
}

export type ScrapeQuery = ApifyScraperQuery | ScraperCityScraperQuery;

export type ScraperRunStatus = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface ScraperStartResult {
  providerRunId: string;
  fileNameHint?: string | null;
}

export interface ScraperStatusResult {
  status: ScraperRunStatus;
  /**
   * Provider raw status payload (for debugging / responseMeta).
   * Keep it small; do NOT store huge blobs here.
   */
  raw?: unknown;
}

export interface ScraperAdapter {
  provider: LeadProvider;

  isEnabled(): boolean;

  /**
   * How often we should poll provider status (ms).
   * Example: 30 minutes.
   */
  pollIntervalMs: number;

  /**
   * Max poll attempts before timing out the run.
   * Example: 180 * 30min = 90h.
   */
  maxPollAttempts: number;

  /**
   * Start external scraping run and return providerRunId.
   */
  start(query: ScrapeQuery): Promise<ScraperStartResult>;

  /**
   * Check provider run status once.
   */
  checkStatus(providerRunId: string): Promise<ScraperStatusResult>;

  /**
   * Fetch & normalize leads when status is SUCCEEDED.
   * Must be idempotent (safe to call twice).
   */
  fetchLeads(input: {
    providerRunId: string;
    query: ScrapeQuery;
    status?: ScraperStatusResult;
  }): Promise<NormalizedLead[]>;
}
