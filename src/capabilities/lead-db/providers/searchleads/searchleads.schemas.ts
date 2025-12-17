import { z } from "zod";

export const SearchLeadsStatusSchema = z.enum(["pending", "completed", "failed"]);
export type SearchLeadsStatus = z.infer<typeof SearchLeadsStatusSchema>;

export const SearchLeadsCreateExportResponseSchema = z.object({
  message: z.string().optional(),
  log_id: z.string().min(1),
});
export type SearchLeadsCreateExportResponse = z.infer<
  typeof SearchLeadsCreateExportResponseSchema
>;

export const SearchLeadsStatusCheckResponseSchema = z.object({
  log: z.object({
    LogID: z.string().min(1),
    status: SearchLeadsStatusSchema,
  }),
});
export type SearchLeadsStatusCheckResponse = z.infer<
  typeof SearchLeadsStatusCheckResponseSchema
>;

export const SearchLeadsLeadRowSchema = z.looseObject({
  id: z.string().optional().nullable(),

  first_name: z.string().optional().nullable(),
  last_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),

  email: z.string().optional().nullable(),
  personal_email: z.string().optional().nullable(),
  email_status: z.string().optional().nullable(),

  phone_number: z.string().optional().nullable(),
  valid_mobile_number: z.string().optional().nullable(),

  linkedin_url: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  seniority: z.string().optional().nullable(),
  function: z.string().optional().nullable(),

  organization_name: z.string().optional().nullable(),
  organization_primary_domain: z.string().optional().nullable(),
  organization_linkedin_url: z.string().optional().nullable(),
  website_url: z.string().optional().nullable(),

  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});
export type SearchLeadsLeadRow = z.infer<typeof SearchLeadsLeadRowSchema>;

export const SearchLeadsResultLogSchema = z.looseObject({
  LogID: z.string().min(1),
  status: SearchLeadsStatusSchema,

  // json -> array, csv/xlsx/pdf -> string url
  data: z.union([z.array(SearchLeadsLeadRowSchema), z.string()]),

  fileName: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  leadsRequested: z.number().int().optional().nullable(),
  leadsEnriched: z.number().int().optional().nullable(),
  creditsUsed: z.number().int().optional().nullable(),
  valid_email_count: z.number().int().optional().nullable(),
});

export const SearchLeadsResultResponseSchema = z.object({
  log: SearchLeadsResultLogSchema,
});
export type SearchLeadsResultResponse = z.infer<typeof SearchLeadsResultResponseSchema>;
