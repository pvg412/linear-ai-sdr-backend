import { LeadProvider } from "@prisma/client";

import type {
  NormalizedLead,
  NormalizedLeadEmail,
  NormalizedCompanyWebsite,
} from "@/capabilities/shared/leadValidate";
import type { SearchLeadsLeadRow } from "./searchleads.schemas";
import {
  composeFullName,
  joinLocationParts,
  normalizeDomain,
  normalizeLinkedinUrl,
  pickFirstEmail,
  trimOrUndefined,
} from "@/capabilities/shared/leadNormalize";
import { normalizeSearchLeadsEmailStatus } from "./searchleads.emailStatus";

function extractEmails(row: SearchLeadsLeadRow): NormalizedLeadEmail[] {
  const emails: NormalizedLeadEmail[] = [];

  const primaryEmail = pickFirstEmail(row.email, row.personal_email);
  if (!primaryEmail) return emails;

  emails.push({
    email: primaryEmail,
    status: normalizeSearchLeadsEmailStatus(row.email_status),
    isPrimary: true,
  });

  return emails;
}

function extractCompanyWebsites(
  row: SearchLeadsLeadRow,
): NormalizedCompanyWebsite[] {
  const websites: NormalizedCompanyWebsite[] = [];

  const companyUrl = trimOrUndefined(row.website_url);
  const companyDomain = normalizeDomain(row.organization_primary_domain);

  if (companyUrl && companyDomain) {
    websites.push({
      url: companyUrl,
      domain: companyDomain,
    });
  }

  return websites;
}

export function mapSearchLeadsRowsToLeads(
  rows: SearchLeadsLeadRow[],
): NormalizedLead[] {
  return rows.map((row) => {
    const firstName = trimOrUndefined(row.first_name);
    const lastName = trimOrUndefined(row.last_name);

    const extractedEmails = extractEmails(row);
    const extractedWebsites = extractCompanyWebsites(row);

    return {
      source: LeadProvider.SEARCH_LEADS,

      externalId: trimOrUndefined(row.id),

      fullName: composeFullName({ name: row.name, firstName, lastName }),
      firstName,
      lastName,

      title: trimOrUndefined(row.title),

      company: trimOrUndefined(row.organization_name),
      companyDomain: normalizeDomain(row.organization_primary_domain),
      companyUrl: trimOrUndefined(row.website_url),

      linkedinUrl: normalizeLinkedinUrl(row.linkedin_url),
      location: joinLocationParts([row.city, row.state, row.country]),

      // Legacy single email (for backward compatibility)
      email: pickFirstEmail(row.email, row.personal_email),
      emailStatus: normalizeSearchLeadsEmailStatus(row.email_status),

      // New: multiple emails with metadata
      emails: extractedEmails.length > 0 ? extractedEmails : undefined,
      // New: multiple company websites
      companyWebsites:
        extractedWebsites.length > 0 ? extractedWebsites : undefined,

      raw: row,
    };
  });
}
