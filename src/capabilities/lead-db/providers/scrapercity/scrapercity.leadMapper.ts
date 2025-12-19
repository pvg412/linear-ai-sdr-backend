import { LeadProvider } from "@prisma/client";

import type { NormalizedLead } from "@/capabilities/shared/leadValidate";
import type { ScraperCityApolloRow } from "./scrapercity.schemas";
import {
  composeFullName,
  normalizeDomain,
  normalizeLinkedinUrl,
  pickFirstEmail,
  trimOrUndefined,
} from "@/capabilities/shared/leadNormalize";

export function mapScraperCityRowsToLeads(rows: ScraperCityApolloRow[]): NormalizedLead[] {
  return rows.map((row) => {
    const firstName = trimOrUndefined(row.first_name);
    const lastName = trimOrUndefined(row.last_name);

    return {
      source: LeadProvider.SCRAPER_CITY, // "data source" (not provider)
      externalId: trimOrUndefined(row.id),

      fullName: composeFullName({ name: row.name, firstName, lastName }),
      firstName,
      lastName,

      title: trimOrUndefined(row.title),

      company: trimOrUndefined(row.company_name),
      companyDomain: normalizeDomain(row.company_domain),
      companyUrl: trimOrUndefined(row.company_website),

      linkedinUrl: normalizeLinkedinUrl(row.linkedin_url),
      location: trimOrUndefined(row.location),

      email: pickFirstEmail(row.work_email, row.email),

      raw: row,
    };
  });
}
