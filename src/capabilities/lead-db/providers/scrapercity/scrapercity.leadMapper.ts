import { LeadProvider } from "@prisma/client";

import type {
  NormalizedLead,
  NormalizedLeadEmail,
  NormalizedCompanyWebsite,
} from "@/capabilities/shared/leadValidate";
import type { ScraperCityApolloRow } from "./scrapercity.schemas";
import {
  composeFullName,
  domainFromUrl,
  joinLocationParts,
  normalizeDomain,
  normalizeLinkedinUrl,
  pickFirstEmail,
  pickString,
  trimOrUndefined,
} from "@/capabilities/shared/leadNormalize";
import { normalizeScraperCityEmailResult } from "@/capabilities/shared/emailStatus";

function buildLocation(row: ScraperCityApolloRow): string | undefined {
  const direct = pickString(row.location);
  if (direct) return direct;

  return joinLocationParts([row.city, row.state, row.country]);
}

function extractEmails(row: ScraperCityApolloRow): NormalizedLeadEmail[] {
  const emails: NormalizedLeadEmail[] = [];

  const email = pickFirstEmail(
    pickString(row.workEmail, row.work_email),
    pickString(row.email),
  );

  if (!email) return emails;

  emails.push({
    email,
    status: normalizeScraperCityEmailResult(
      pickString(row.emailResult, row.email_result),
    ),
    isPrimary: true,
  });

  return emails;
}

function extractCompanyWebsites(
  row: ScraperCityApolloRow,
): NormalizedCompanyWebsite[] {
  const websites: NormalizedCompanyWebsite[] = [];

  const companyUrl = pickString(row.orgWebsite, row.company_website);
  const domainCandidate = pickString(row.orgDomain, row.company_domain);
  const companyDomain =
    normalizeDomain(domainCandidate) ??
    normalizeDomain(domainFromUrl(companyUrl)) ??
    normalizeDomain(companyUrl);

  if (companyUrl && companyDomain) {
    websites.push({
      url: companyUrl,
      domain: companyDomain,
    });
  }

  return websites;
}

export function mapScraperCityRowsToLeads(
  rows: ScraperCityApolloRow[],
): NormalizedLead[] {
  return rows.map((row) => {
    const firstName = pickString(row.firstName, row.first_name);
    const lastName = pickString(row.lastName, row.last_name);

    const fullNameRaw = pickString(row.fullName, row.full_name, row.name);
    const fullName =
      fullNameRaw ?? composeFullName({ name: undefined, firstName, lastName });

    const title = pickString(row.position, row.title);

    const company = pickString(row.orgName, row.company_name);
    const companyUrl = pickString(row.orgWebsite, row.company_website);

    const domainCandidate = pickString(row.orgDomain, row.company_domain);
    const companyDomain =
      normalizeDomain(domainCandidate) ??
      normalizeDomain(domainFromUrl(companyUrl)) ??
      normalizeDomain(companyUrl);

    const linkedinUrl = normalizeLinkedinUrl(
      pickString(row.linkedinUrl, row.linkedin_url),
    );

    const email = pickFirstEmail(
      pickString(row.workEmail, row.work_email),
      pickString(row.email),
    );

    const location = buildLocation(row);

    const extractedEmails = extractEmails(row);
    const extractedWebsites = extractCompanyWebsites(row);

    return {
      source: LeadProvider.SCRAPER_CITY,
      externalId: pickString(row.id),

      fullName: fullName ? trimOrUndefined(fullName) : undefined,
      firstName: firstName ? trimOrUndefined(firstName) : undefined,
      lastName: lastName ? trimOrUndefined(lastName) : undefined,

      title: title ? trimOrUndefined(title) : undefined,

      company: company ? trimOrUndefined(company) : undefined,
      companyDomain: companyDomain ?? undefined,
      companyUrl: companyUrl ? trimOrUndefined(companyUrl) : undefined,

      linkedinUrl: linkedinUrl ?? undefined,
      location: location ?? undefined,

      // Legacy single email (for backward compatibility)
      email: email ?? undefined,
      emailStatus: normalizeScraperCityEmailResult(
        pickString(row.emailResult, row.email_result),
      ),

      // New: multiple emails with metadata
      emails: extractedEmails.length > 0 ? extractedEmails : undefined,
      // New: multiple company websites
      companyWebsites:
        extractedWebsites.length > 0 ? extractedWebsites : undefined,

      // keep provider row for debugging
      raw: row,
    };
  });
}
