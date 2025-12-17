import { z } from "zod";

export const ScraperCityStartResponseSchema = z.object({
  runId: z.string().min(1),
});

export const ScraperCityStatusResponseSchema = z.object({
  status: z.string().min(1),
  statusMessage: z.string().optional().nullable(),
  handled: z.number().optional().nullable(),
  runTimeSecs: z.number().optional().nullable(),
  outputUrl: z.string().optional().nullable(),
});

export type ScraperCityStatusResponse = z.infer<typeof ScraperCityStatusResponseSchema>;

export const ScraperCityApolloRowSchema = z.looseObject({
  id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  title: z.string().optional().nullable(),

  company_name: z.string().optional().nullable(),
  company_domain: z.string().optional().nullable(),
  company_website: z.string().optional().nullable(),

  linkedin_url: z.string().optional().nullable(),
  location: z.string().optional().nullable(),

  work_email: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
});

export type ScraperCityApolloRow = z.infer<typeof ScraperCityApolloRowSchema>;
