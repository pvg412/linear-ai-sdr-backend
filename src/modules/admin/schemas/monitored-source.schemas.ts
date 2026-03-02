import { z } from "zod";
import { MonitoredSourceChannel } from "@prisma/client";

// ── Response schema ─────────────────────────────────────────────────

export const MonitoredSourceResponseSchema = z.object({
  id: z.string(),
  channel: z.enum(MonitoredSourceChannel),
  value: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type MonitoredSourceResponse = z.infer<typeof MonitoredSourceResponseSchema>;

// ── Create body ─────────────────────────────────────────────────────

export const CreateMonitoredSourceBodySchema = z.object({
  channel: z.enum(MonitoredSourceChannel),
  value: z
    .string()
    .min(1)
    .max(100)
    .transform((v) => v.trim().toLowerCase().replace(/^r\//, "")),
  description: z.string().max(500).optional(),
});

export type CreateMonitoredSourceBody = z.infer<typeof CreateMonitoredSourceBodySchema>;

// ── Update body ─────────────────────────────────────────────────────

export const UpdateMonitoredSourceBodySchema = z.object({
  enabled: z.boolean(),
});

export type UpdateMonitoredSourceBody = z.infer<typeof UpdateMonitoredSourceBodySchema>;

// ── Route params ────────────────────────────────────────────────────

export const MonitoredSourceParamsSchema = z.object({
  id: z.string().min(1),
});

// ── Query params (optional channel filter for GET) ──────────────────

export const MonitoredSourceQuerySchema = z.object({
  channel: z.enum(MonitoredSourceChannel).optional(),
});
