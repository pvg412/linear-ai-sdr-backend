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
