import { z } from "zod";
import { LeadSource, ScraperProvider } from "@prisma/client";

export const NormalizedLeadSchema = z
  .object({
    source: z.enum(LeadSource),

    externalId: z.string().min(1).optional(),

    fullName: z.string().min(1).optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),

    title: z.string().min(1).optional(),

    company: z.string().min(1).optional(),
    companyDomain: z.string().min(1).optional(),
    companyUrl: z.string().min(1).optional(),

    linkedinUrl: z.string().min(1).optional(),
    location: z.string().min(1).optional(),

    // This is strict; if you have lots of non-RFC emails, consider relaxing to z.string().min(3)
    email: z.email().optional(),

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
  opts?: { mode?: LeadValidationMode; provider?: ScraperProvider; minValid?: number },
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
