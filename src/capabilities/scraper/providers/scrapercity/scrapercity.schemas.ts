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

export type ScraperCityStatusResponse = z.infer<
  typeof ScraperCityStatusResponseSchema
>;

/**
 * Accept camelCase + snake_case, and passthrough (important for raw/debug).
 */
export const ScraperCityApolloRowSchema = z.looseObject({
  id: z.string().optional().nullable(),

  // person
  fullName: z.string().optional().nullable(),
  full_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),

  firstName: z.string().optional().nullable(),
  first_name: z.string().optional().nullable(),

  lastName: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),

  // role/title
  position: z.string().optional().nullable(),
  title: z.string().optional().nullable(),

  // linkedin
  linkedinUrl: z.string().optional().nullable(),
  linkedin_url: z.string().optional().nullable(),

  // location
  location: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),

  // email
  workEmail: z.string().optional().nullable(),
  work_email: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  emailResult: z.string().optional().nullable(),
  email_result: z.string().optional().nullable(),

  // company
  orgName: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),

  orgWebsite: z.string().optional().nullable(),
  company_website: z.string().optional().nullable(),

  orgDomain: z.string().optional().nullable(),
  company_domain: z.string().optional().nullable(),
});

export type ScraperCityApolloRow = z.infer<typeof ScraperCityApolloRowSchema>;

/**
 * Email validator CSV row.
 * Example columns: email,email_quality,email_result,free,subresult
 */
export const ScraperCityEmailValidationRowSchema = z.looseObject({
  email: z.string().optional().nullable(),
  email_quality: z.string().optional().nullable(),
  email_result: z.string().optional().nullable(),
  free: z.union([z.string(), z.boolean()]).optional().nullable(),
  subresult: z.string().optional().nullable(),
});

export type ScraperCityEmailValidationRow = z.infer<
  typeof ScraperCityEmailValidationRowSchema
>;
