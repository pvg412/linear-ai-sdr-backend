import { LeadSource } from "@prisma/client";

import type { NormalizedLeadForCreate } from "@/capabilities/lead-db/lead-db.dto";
import type { ScraperCityApolloRow } from "./scrapercity.schemas";
import {
  composeFullName,
  normalizeDomain,
  normalizeLinkedinUrl,
  pickFirstEmail,
  trimOrUndefined,
} from "@/capabilities/lead-db/shared/leadNormalize";

export function mapScraperCityRowsToLeads(rows: ScraperCityApolloRow[]): NormalizedLeadForCreate[] {
  return rows.map((row) => {
    const firstName = trimOrUndefined(row.first_name);
    const lastName = trimOrUndefined(row.last_name);

    return {
      source: LeadSource.SCRAPER_CITY, // "data source" (not provider)
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
