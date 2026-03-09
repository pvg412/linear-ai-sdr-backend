import { z } from "zod";

const HirebaseJobLocationSchema = z.object({
  city: z.string().nullish(),
  region: z.string().nullish(),
  country: z.string().nullish(),
});

const HirebaseSalaryRangeSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    currency: z.string().optional(),
    period: z.string().optional(),
  })
  .nullable()
  .optional();

export const HirebaseJobSchema = z.object({
  _id: z.string(),
  job_title: z.string().optional(),
  job_categories: z.array(z.string()).optional(),
  job_type: z.string().optional(),
  location_type: z.string().optional(),
  locations: z.array(HirebaseJobLocationSchema).optional(),
  salary_range: HirebaseSalaryRangeSchema,
  date_posted: z.string().optional(),
  requirements_summary: z.string().optional(),
  skills: z.array(z.string()).optional(),
  technologies: z.array(z.string()).optional(),
  experience: z.string().optional(),
  team: z.string().optional(),
  company_name: z.string().optional(),
  company_slug: z.string().optional(),
});

export const HirebaseSearchResponseSchema = z.object({
  jobs: z.array(HirebaseJobSchema).default([]),
  total_count: z.number().optional(),
  company_count: z.number().optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
  total_pages: z.number().optional(),
});

export type HirebaseSearchResponseParsed = z.infer<
  typeof HirebaseSearchResponseSchema
>;
