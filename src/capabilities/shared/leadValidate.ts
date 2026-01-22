import { z } from "zod";
import {
  EmailStatus,
  LeadProvider,
  CompanySize,
  SeniorityLevel,
} from "@prisma/client";

// Schema for multiple emails with metadata
export const NormalizedLeadEmailSchema = z.object({
  email: z.email(),
  deliverable: z.boolean().optional(),
  catchAllDomain: z.boolean().optional(),
  validEmailServer: z.boolean().optional(),
  free: z.boolean().optional(),
  status: z.enum(EmailStatus).optional(),
  qualityScore: z.number().int().min(0).max(100).optional(),
  isPrimary: z.boolean().optional(),
});

export type NormalizedLeadEmail = z.infer<typeof NormalizedLeadEmailSchema>;

// Schema for multiple company websites
export const NormalizedCompanyWebsiteSchema = z.object({
  url: z.string().min(1),
  domain: z.string().min(1),
  validEmailServer: z.boolean().optional(),
});

export type NormalizedCompanyWebsite = z.infer<
  typeof NormalizedCompanyWebsiteSchema
>;

export const NormalizedLeadSchema = z
  .object({
    source: z.enum(LeadProvider),

    externalId: z.string().min(1).optional(),

    fullName: z.string().min(1).optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),

    title: z.string().min(1).optional(),
    headline: z.string().min(1).optional(),

    company: z.string().min(1).optional(),
    companyDomain: z.string().min(1).optional(),
    companyUrl: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
    companyLinkedinUrl: z.string().min(1).optional(),
    companySize: z.enum(CompanySize).optional(),
    companyIndustry: z.string().min(1).optional(),
    companyLocation: z.string().min(1).optional(),

    currentPosition: z.string().min(1).optional(),
    seniorityLevel: z.enum(SeniorityLevel).optional(),
    department: z.string().min(1).optional(),
    yearsInPosition: z.number().int().min(0).optional(),
    yearsInCompany: z.number().int().min(0).optional(),
    totalExperienceYears: z.number().int().min(0).optional(),

    linkedinUrl: z.string().min(1).optional(),
    location: z.string().min(1).optional(),

    // Legacy single email (for backward compatibility)
    email: z.email().optional(),
    emailStatus: z.enum(EmailStatus).optional(),

    // New: multiple emails with metadata
    emails: z.array(NormalizedLeadEmailSchema).optional(),
    // New: multiple company websites
    companyWebsites: z.array(NormalizedCompanyWebsiteSchema).optional(),

    raw: z.unknown().optional(),
  })
  .superRefine((lead, ctx) => {
    const hasStrongId =
      !!lead.email ||
      !!lead.linkedinUrl ||
      !!lead.externalId ||
      (!!lead.fullName && (!!lead.companyDomain || !!lead.company));

    if (!hasStrongId) {
      ctx.addIssue({
        code: "custom",
        message:
          "Lead must have at least one stable identifier (email/linkedin/externalId or fullName+company).",
      });
    }
  });

export type NormalizedLead = z.infer<typeof NormalizedLeadSchema>;

export type LeadValidationMode = "strict" | "drop";

export function validateNormalizedLeads<T extends object>(
  leads: T[],
  opts?: {
    mode?: LeadValidationMode;
    provider?: LeadProvider;
    minValid?: number;
  },
): T[] {
  const mode = opts?.mode ?? "drop";
  const minValid = opts?.minValid ?? 1;

  if (mode === "strict") {
    // Will throw on first invalid
    return NormalizedLeadSchema.array().parse(leads) as unknown as T[];
  }

  const out: T[] = [];
  let dropped = 0;

  for (const lead of leads) {
    const res = NormalizedLeadSchema.safeParse(lead);
    if (res.success) out.push(lead);
    else dropped++;
  }

  if (dropped > 0) {
    // keep log-friendly format
    console.warn("[LeadValidate] dropped invalid normalized leads", {
      provider: opts?.provider,
      dropped,
      kept: out.length,
    });
  }

  if (out.length < minValid) {
    throw new Error(
      `No valid leads after validation (provider=${opts?.provider ?? "n/a"})`,
    );
  }

  return out;
}

export function dedupeLeads(leads: NormalizedLead[]): NormalizedLead[] {
  const seen = new Set<string>();
  const out: NormalizedLead[] = [];

  for (const lead of leads) {
    const key =
      lead.linkedinUrl?.trim() ||
      lead.externalId?.trim() ||
      lead.email?.trim() ||
      "";

    // If we can’t build a stable key, don’t dedupe this record (or drop it).
    if (!key) {
      out.push(lead);
      continue;
    }

    const scoped = `${lead.source}:${key}`;
    if (seen.has(scoped)) continue;
    seen.add(scoped);
    out.push(lead);
  }

  return out;
}
