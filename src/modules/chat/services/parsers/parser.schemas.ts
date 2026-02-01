// Zod schemas for prompt parser service

import { z } from "zod";
import {
  CompanySizeSchema,
  LeadDbCanonicalFiltersSchema,
} from "@/capabilities/lead-db/lead-db.dto";

export const LimitSchema = z.number().int().min(1).max(50_000);

export const ScraperQuerySchema = z
  .object({
    industry: z.string().trim().min(1).optional(),
    titles: z.array(z.string().trim().min(1)).default([]),
    locations: z.array(z.string().trim().min(1)).default([]),
    companySize: CompanySizeSchema.optional(),
    companyKeywords: z.array(z.string().trim().min(1)).optional(),
  })
  .strip();

export const AiLeadDbOutputSchema = z
  .object({
    limit: LimitSchema.optional(),
    query: LeadDbCanonicalFiltersSchema.default({}),
  })
  .strip();

export const AiScraperOutputSchema = z
  .object({
    limit: LimitSchema.optional(),
    query: ScraperQuerySchema.default({ titles: [], locations: [] }),
  })
  .strip();

export type LeadDbQueryOut = z.infer<typeof LeadDbCanonicalFiltersSchema>;
export type ScraperQueryOut = z.infer<typeof ScraperQuerySchema>;
export type CompanySizeStr = z.infer<typeof CompanySizeSchema>;

// Re-export for convenience
export { LeadDbCanonicalFiltersSchema, CompanySizeSchema };
