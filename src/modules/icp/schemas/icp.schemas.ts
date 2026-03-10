import { z } from "zod";

// ── LinkedIn company size codes ───────────────────────────────────────

/**
 * LinkedIn company size single-letter codes (A through I).
 * Each maps to a headcount range used by LinkedIn's Sales Navigator and search APIs.
 */
export const COMPANY_SIZE_OPTIONS = [
  { code: "A", label: "Self-employed" },
  { code: "B", label: "1-10 employees" },
  { code: "C", label: "11-50 employees" },
  { code: "D", label: "51-200 employees" },
  { code: "E", label: "201-500 employees" },
  { code: "F", label: "501-1,000 employees" },
  { code: "G", label: "1,001-5,000 employees" },
  { code: "H", label: "5,001-10,000 employees" },
  { code: "I", label: "10,001+ employees" },
] as const;

const VALID_SIZE_CODES = COMPANY_SIZE_OPTIONS.map((o) => o.code) as [string, ...string[]];

const CompanySizeCodeSchema = z.enum(VALID_SIZE_CODES);

// ── Industry schema ───────────────────────────────────────────────────

const IcpIndustrySchema = z.object({
  industryId: z
    .string()
    .trim()
    .min(1, "industryId is required"),
  label: z
    .string()
    .trim()
    .min(1, "label is required")
    .max(200, "label must be at most 200 characters"),
});

// ── Location schema ───────────────────────────────────────────────────

const IcpLocationSchema = z
  .string()
  .trim()
  .min(1, "Location must not be empty")
  .max(200, "Location must be at most 200 characters");

// ── Upsert body (PUT /company/icp) ───────────────────────────────────

export const upsertIcpBodySchema = z.object({
  locations: z
    .array(IcpLocationSchema)
    .max(50, "At most 50 locations allowed")
    .default([])
    .refine(
      (items) => new Set(items.map((l) => l.toLowerCase())).size === items.length,
      { message: "Duplicate locations are not allowed" },
    ),

  companySizes: z
    .array(CompanySizeCodeSchema)
    .max(VALID_SIZE_CODES.length, `At most ${VALID_SIZE_CODES.length} size codes allowed`)
    .default([])
    .refine(
      (items) => new Set(items).size === items.length,
      { message: "Duplicate company size codes are not allowed" },
    ),

  industries: z
    .array(IcpIndustrySchema)
    .max(100, "At most 100 industries allowed")
    .default([])
    .refine(
      (items) => {
        const ids = items.map((i) => i.industryId);
        return new Set(ids).size === ids.length;
      },
      { message: "Duplicate industry IDs are not allowed" },
    ),
});

export type UpsertIcpBody = z.infer<typeof upsertIcpBodySchema>;
