import { z } from "zod";

// ── Request schemas ────────────────────────────────────────────────────────────

// Accepts either a cuid/UUID (when no "@") or an email address
export const UserIdentifierParamsSchema = z.object({
  userIdentifier: z.string().min(1, "userIdentifier is required"),
});

export const AdjustBalanceBodySchema = z.object({
  // Signed integer in cents: positive = credit, negative = debit
  amountCents: z
    .number()
    .int("amountCents must be an integer")
    .refine((v) => v !== 0, { message: "amountCents must not be zero" }),
  reason: z
    .string()
    .min(1, "reason is required")
    .max(500, "reason must be 500 characters or fewer"),
});

export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type AdjustBalanceBody = z.infer<typeof AdjustBalanceBodySchema>;
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
export type UserIdentifierParams = z.infer<typeof UserIdentifierParamsSchema>;
