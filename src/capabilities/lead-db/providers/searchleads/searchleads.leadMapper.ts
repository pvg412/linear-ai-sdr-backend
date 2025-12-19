import { LeadProvider } from "@prisma/client";

import type { NormalizedLead } from "@/capabilities/shared/leadValidate";
import type { SearchLeadsLeadRow } from "./searchleads.schemas";
import {
	composeFullName,
	joinLocationParts,
	normalizeDomain,
	normalizeLinkedinUrl,
	pickFirstEmail,
	trimOrUndefined,
} from "@/capabilities/shared/leadNormalize";

export function mapSearchLeadsRowsToLeads(
	rows: SearchLeadsLeadRow[]
): NormalizedLead[] {
	return rows.map((row) => {
		const firstName = trimOrUndefined(row.first_name);
		const lastName = trimOrUndefined(row.last_name);

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

			email: pickFirstEmail(row.email, row.personal_email),

			raw: row,
		};
	});
}
