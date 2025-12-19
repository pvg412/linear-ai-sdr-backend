import type {
  LeadDbAdapterResult,
} from "./lead-db.dto";
import { NormalizedLead } from "../shared/leadValidate";

export function mergeAndTrimLeadDbResults(
  providerResults: LeadDbAdapterResult[],
  limit: number,
): NormalizedLead[] {
  const out: NormalizedLead[] = [];
  const seen = new Set<string>();

  for (const r of providerResults) {
    for (const lead of r.leads) {
      const key = buildLeadDedupeKey(lead);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);

      out.push(lead);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

function buildLeadDedupeKey(lead: NormalizedLead): string | null {
  const norm = (v?: string) => (v ?? "").trim().toLowerCase();

  const email = norm(lead.email);
  if (email) return `email:${email}`;

  const linkedin = norm(lead.linkedinUrl);
  if (linkedin) return `linkedin:${linkedin}`;

  const externalId = norm(lead.externalId);
  if (externalId) return `external:${externalId}`;

  const fullName = norm(lead.fullName);
  const companyDomain = norm(lead.companyDomain);
  const company = norm(lead.company);

  if (fullName && (companyDomain || company)) {
    return `name_company:${fullName}|${companyDomain || company}`;
  }

  return null;
}
