import { z } from "zod";

// Request params schema
export const CompanyResearchParamsSchema = z.object({
  leadId: z.cuid(),
});

// Optional query parameters for filtering
export const CompanyResearchQuerySchema = z.object({
  // Date range filter (optional)
  recency: z.enum(["day", "week", "month", "year"]).optional(),

  // Maximum number of results per category
  maxResults: z.coerce.number().int().min(1).max(20).default(5),
});

// Individual research item in response
export const CompanyResearchItemSchema = z.object({
  date: z.string().nullable(), // ISO date string or null if unknown
  summary: z.string(), // Short summary/extract
  sourceUrl: z.url(), // Source URL
  category: z.enum(["news", "blog", "activity", "website"]),
});

// Full response schema
export const CompanyResearchResponseSchema = z.object({
  leadId: z.string(),
  company: z.string(),
  companyDomain: z.string().nullable(),
  searchedAt: z.string(), // ISO timestamp
  items: z.array(CompanyResearchItemSchema),
});

export type CompanyResearchParams = z.infer<typeof CompanyResearchParamsSchema>;
export type CompanyResearchQuery = z.infer<typeof CompanyResearchQuerySchema>;
export type CompanyResearchItem = z.infer<typeof CompanyResearchItemSchema>;
export type CompanyResearchResponse = z.infer<
  typeof CompanyResearchResponseSchema
>;
