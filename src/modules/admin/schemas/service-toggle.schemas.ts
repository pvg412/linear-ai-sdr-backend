import { z } from "zod";

// ── Response schemas (never expose serviceKey) ──────────────────────

export const ServiceToggleResponseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  enabled: z.boolean(),
  updatedAt: z.coerce.date(),
});

export type ServiceToggleResponse = z.infer<typeof ServiceToggleResponseSchema>;

// ── Update body ─────────────────────────────────────────────────────

export const UpdateServiceToggleBodySchema = z.object({
  enabled: z.boolean(),
});

export type UpdateServiceToggleBody = z.infer<typeof UpdateServiceToggleBodySchema>;

// ── Route params ────────────────────────────────────────────────────

export const ServiceToggleParamsSchema = z.object({
  id: z.string().min(1),
});
