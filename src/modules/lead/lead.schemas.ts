import { z } from "zod";
import { LeadSource, LeadStatus } from "@prisma/client";

export const leadInputSchema = z.object({
  source: z.enum(LeadSource).optional(),
  externalId: z.string().optional(),

  fullName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  companyDomain: z.string().optional(),
  companyUrl: z.string().optional(),
  linkedinUrl: z.string().optional(),
  location: z.string().optional(),

  email: z.string().email().optional(),
  raw: z.unknown().optional(),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export const bulkCreateLeadsBodySchema = z.object({
  searchTaskId: z.string().min(1),
  leads: z.array(leadInputSchema).min(1),
});
export type BulkCreateLeadsBody = z.infer<typeof bulkCreateLeadsBodySchema>;

export const updateLeadStatusBodySchema = z.object({
  status: z.enum(LeadStatus),
});
export type UpdateLeadStatusBody = z.infer<typeof updateLeadStatusBodySchema>;

export const getLeadParamsSchema = z.object({
  id: z.string().min(1),
});
export type GetLeadParams = z.infer<typeof getLeadParamsSchema>;

export const getLeadsBySearchTaskParamsSchema = z.object({
  searchTaskId: z.string().min(1),
});
export type GetLeadsBySearchTaskParams = z.infer<
  typeof getLeadsBySearchTaskParamsSchema
>;

export const getLeadsQuerySchema = z.object({
  status: z.enum(LeadStatus).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type GetLeadsQuery = z.infer<typeof getLeadsQuerySchema>;
