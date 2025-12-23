import type { LeadDbAdapterResult } from "./lead-db.dto";
import { NormalizedLead } from "../shared/leadValidate";

export function mergeAndTrimLeadDbResults(
	providerResults: LeadDbAdapterResult[],
	limit: number
): NormalizedLead[] {
	const out: NormalizedLead[] = [];

	// Track each identifier separately: a lead is duplicate if ANY id already seen
	const seenEmail = new Set<string>();
	const seenLinkedin = new Set<string>();
	const seenExternal = new Set<string>();
	const seenNameCompany = new Set<string>();

	for (const r of providerResults) {
		for (const lead of r.leads) {
			const keys = buildLeadDedupeKeys(lead);

			// Duplicate if ANY known identifier collides
			if (keys.email && seenEmail.has(keys.email)) continue;
			if (keys.linkedin && seenLinkedin.has(keys.linkedin)) continue;
			if (keys.externalId && seenExternal.has(keys.externalId)) continue;
			if (keys.nameCompany && seenNameCompany.has(keys.nameCompany)) continue;

			// Accept lead, mark ALL identifiers as seen
			if (keys.email) seenEmail.add(keys.email);
			if (keys.linkedin) seenLinkedin.add(keys.linkedin);
			if (keys.externalId) seenExternal.add(keys.externalId);
			if (keys.nameCompany) seenNameCompany.add(keys.nameCompany);

			out.push(lead);
			if (out.length >= limit) return out;
		}
	}

	return out;
}

function buildLeadDedupeKeys(lead: NormalizedLead): {
	email: string | null;
	linkedin: string | null;
	externalId: string | null;
	nameCompany: string | null;
} {
	const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();

	const email = norm(lead.email);
	const linkedin = norm(lead.linkedinUrl);
	const externalId = norm(lead.externalId);

	const fullName = norm(lead.fullName);
	const companyDomain = norm(lead.companyDomain);
	const company = norm(lead.company);

	const nameCompany =
		fullName && (companyDomain || company)
			? `name_company:${fullName}|${companyDomain || company}`
			: "";

	return {
		email: email ? `email:${email}` : null,
		linkedin: linkedin ? `linkedin:${linkedin}` : null,
		externalId: externalId ? `external:${externalId}` : null,
		nameCompany: nameCompany ? nameCompany : null,
	};
}
