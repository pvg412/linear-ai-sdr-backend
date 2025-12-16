import { LeadSource } from "@prisma/client";
import { z } from "zod";

export const leadDbFiltersSchema = z
  .object({
    seniorityLevel: z.string().optional(),
    functionDept: z.string().optional(),

    personTitles: z.array(z.string().min(1)).optional(),
    personCountry: z.string().optional(),
    personState: z.string().optional(),
    personCities: z.array(z.string().min(1)).optional(),

    companyIndustry: z.string().optional(),
    companySize: z.string().optional(),
    companyCountry: z.string().optional(),
    companyState: z.string().optional(),
    companyCities: z.array(z.string().min(1)).optional(),

    companyDomains: z.array(z.string().min(1)).optional(),
    companyKeywords: z.array(z.string().min(1)).optional(),

    hasPhone: z.boolean().optional(),
  })
  .strict();

export const createSearchTaskBodySchema = z.object({
  prompt: z.string().min(3),
  chatId: z.string().min(1),
  limit: z.number().int().positive().max(1000).default(50),
  source: z.enum(LeadSource).default(LeadSource.MANUAL),

  industry: z.string().optional(),
  // Prisma fields are non-null String[]; default to empty arrays.
  titles: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  companySize: z.string().optional(),

  leadDbFilters: leadDbFiltersSchema.optional(),
});

export type CreateSearchTaskBody = z.infer<typeof createSearchTaskBodySchema>;

export const getSearchTaskParamsSchema = z.object({
  id: z.string().min(1),
});

export type GetSearchTaskParams = z.infer<typeof getSearchTaskParamsSchema>;

export const markRunningBodySchema = z.object({
  runId: z.string().min(1),
  fileName: z.string().min(1),
});

export const markDoneBodySchema = z.object({
  totalLeads: z.number().int().nonnegative(),
});

export const markFailedBodySchema = z.object({
  error: z.string().min(1),
});
