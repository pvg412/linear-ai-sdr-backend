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

function pickString(...vals: Array<unknown>): string | undefined {
	for (const v of vals) {
		if (typeof v !== "string") continue;
		const t = trimOrUndefined(v);
		if (t) return t;
	}
	return undefined;
}

function buildLocation(row: ScraperCityApolloRow): string | undefined {
	const direct = pickString(row.location);
	if (direct) return direct;

	const city = pickString(row.city);
	const state = pickString(row.state);
	const country = pickString(row.country);

	const parts = [city, state, country].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : undefined;
}

function domainFromUrlMaybe(url: string | undefined): string | undefined {
	const u = trimOrUndefined(url);
	if (!u) return undefined;

	try {
		const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
		const parsed = new URL(withScheme);
		return parsed.hostname || undefined;
	} catch {
		return undefined;
	}
}

export function mapScraperCityRowsToLeads(
	rows: ScraperCityApolloRow[]
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
			normalizeDomain(domainFromUrlMaybe(companyUrl)) ??
			normalizeDomain(companyUrl);

		const linkedinUrl = normalizeLinkedinUrl(
			pickString(row.linkedinUrl, row.linkedin_url)
		);

		const email = pickFirstEmail(
			pickString(row.workEmail, row.work_email),
			pickString(row.email)
		);

		const location = buildLocation(row);

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

			email: email ?? undefined,

			raw: row,
		};
	});
}
