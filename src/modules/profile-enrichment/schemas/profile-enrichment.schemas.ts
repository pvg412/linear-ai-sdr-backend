import { z } from "zod";

// Request params
export const ProfileEnrichmentParamsSchema = z.object({
  leadId: z.cuid(),
});

// Request params with enrichment request ID
export const ProfileEnrichmentStatusParamsSchema = z.object({
  leadId: z.cuid(),
  enrichmentRequestId: z.cuid(),
});

// POST /leads/:leadId/enrichment - request body
export const RequestEnrichmentBodySchema = z
  .object({
    force: z.boolean().optional().default(false),
  })
  .strict();

// PATCH /leads/:leadId/enrichment/review - request body
export const ReviewEnrichmentBodySchema = z
  .object({
    decisions: z
      .array(
        z.object({
          fieldChangeId: z.cuid(),
          action: z.enum(["approve", "reject"]),
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();

// GET /leads/:leadId/enrichment/history - query params
export const EnrichmentHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// Response types
export type ProfileEnrichmentParams = z.infer<
  typeof ProfileEnrichmentParamsSchema
>;
export type RequestEnrichmentBody = z.infer<typeof RequestEnrichmentBodySchema>;
export type ReviewEnrichmentBody = z.infer<typeof ReviewEnrichmentBodySchema>;
export type EnrichmentHistoryQuery = z.infer<
  typeof EnrichmentHistoryQuerySchema
>;
