import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Request body schemas                                               */
/* ------------------------------------------------------------------ */

export const StartPipelineBodySchema = z.object({
  pipelineKey: z.string().min(1).max(128),
  input: z
    .record(z.string(), z.unknown())
    .default({}),
});

export type StartPipelineBody = z.infer<typeof StartPipelineBodySchema>;

/* ------------------------------------------------------------------ */
/*  Path param schemas                                                */
/* ------------------------------------------------------------------ */

export const PipelineRunParamsSchema = z.object({
  id: z.string().min(1),
});

export type PipelineRunParams = z.infer<typeof PipelineRunParamsSchema>;

/* ------------------------------------------------------------------ */
/*  Query param schemas                                               */
/* ------------------------------------------------------------------ */

export const ListPipelineRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"])
    .optional(),
});

export type ListPipelineRunsQuery = z.infer<typeof ListPipelineRunsQuerySchema>;

/* ------------------------------------------------------------------ */
/*  Outreach management schemas                                       */
/* ------------------------------------------------------------------ */

export const AcceptOutreachBodySchema = z.object({
  messageId: z.string().min(1),
});

export type AcceptOutreachBody = z.infer<typeof AcceptOutreachBodySchema>;

export const CustomOutreachBodySchema = z.object({
  messageId: z.string().min(1),
  body: z.string().min(1),
  subject: z.string().optional(),
});

export type CustomOutreachBody = z.infer<typeof CustomOutreachBodySchema>;

export const OutreachMessageParamsSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
});

export type OutreachMessageParams = z.infer<typeof OutreachMessageParamsSchema>;
