import { z } from 'zod';

export const createSearchTaskBodySchema = z.object({
  prompt: z.string().min(3),
  chatId: z.string().min(1),
  limit: z.number().int().positive().max(1000).default(50),

  industry: z.string().optional(),
  titles: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  companySize: z.string().optional(),
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
