import { LeadProvider } from "@prisma/client";

import type { NormalizedLead } from "@/capabilities/shared/leadValidate";
import {
	composeFullName,
	joinLocationParts,
	normalizeDomain,
	normalizeLinkedinUrl,
	pickFirstEmail,
	trimOrUndefined,
} from "@/capabilities/shared/leadNormalize";
import type {
	ApifyLinkedinProfileCompany,
	ApifyLinkedinProfileExperience,
	ApifyLinkedinProfileRow,
} from "./apify.schemas";

function cleanValue(value: unknown): string | undefined {
	const trimmed = trimOrUndefined(value);
	if (!trimmed) return undefined;
	const lower = trimmed.toLowerCase();
	if (lower === "undefined" || lower === "null") return undefined;
	return trimmed;
}

function pickString(...vals: unknown[]): string | undefined {
	for (const v of vals) {
		const t = cleanValue(v);
		if (t) return t;
	}
	return undefined;
}

function buildLinkedinUrl(publicIdentifier: unknown): string | undefined {
	const raw = cleanValue(publicIdentifier);
	if (!raw) return undefined;

	if (/^https?:\/\//i.test(raw)) return raw;

	const trimmed = raw.replace(/^\/+|\/+$/g, "");
	return `https://www.linkedin.com/in/${trimmed}/`;
}

function normalizeCompanyDomain(url: string | undefined): string | undefined {
	const domain = normalizeDomain(url);
	if (!domain) return undefined;
	if (domain.toLowerCase().endsWith("linkedin.com")) return undefined;
	return domain;
}

function pickLocation(
	location: ApifyLinkedinProfileRow["location"]
): string | undefined {
	if (typeof location === "string") return cleanValue(location);
	if (!location) return undefined;

	const direct = pickString(location.linkedinText, location.parsed?.text);
	if (direct) return direct;

	return joinLocationParts([
		location.parsed?.city,
		location.parsed?.state ?? location.parsed?.regionCode,
		location.parsed?.countryFull ?? location.parsed?.country,
	]);
}

function pickCompanyEntry(
	entries:
		| ApifyLinkedinProfileCompany[]
		| ApifyLinkedinProfileExperience[]
		| null
		| undefined
): ApifyLinkedinProfileCompany | ApifyLinkedinProfileExperience | undefined {
	if (!Array.isArray(entries)) return undefined;
	for (const entry of entries) {
		const name = pickString(entry.companyName);
		const url = pickString(entry.companyLinkedinUrl, entry.companyWebsite);
		if (name || url) return entry;
	}
	return undefined;
}

function pickExperienceEntry(
	entries: ApifyLinkedinProfileExperience[] | null | undefined
): ApifyLinkedinProfileExperience | undefined {
	if (!Array.isArray(entries)) return undefined;
	for (const entry of entries) {
		const name = pickString(entry.companyName);
		const url = pickString(entry.companyLinkedinUrl, entry.companyWebsite);
		if (name || url) return entry;
	}
	return undefined;
}

function readStringArray(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	const out: string[] = [];
	for (const v of values) {
		const t = cleanValue(v);
		if (t) out.push(t);
	}
	return out;
}

export function mapApifyLinkedinRowsToLeads(
	rows: ApifyLinkedinProfileRow[]
): NormalizedLead[] {
	return rows.map((row) => {
		const firstName = pickString(row.firstName);
		const lastName = pickString(row.lastName);
		const fullNameRaw = pickString(row.fullName);
		const fullName =
			fullNameRaw ?? composeFullName({ name: undefined, firstName, lastName });

		const linkedinUrlRaw =
			pickString(row.linkedinUrl) ?? buildLinkedinUrl(row.publicIdentifier);
		const linkedinUrl = normalizeLinkedinUrl(linkedinUrlRaw);

		const title =
			pickString(row.position) ??
			pickString(row.headline) ??
			pickString(pickExperienceEntry(row.experience)?.position);

		const companyEntry =
			pickCompanyEntry(row.currentPosition) ?? pickCompanyEntry(row.experience);

		const company = pickString(companyEntry?.companyName, row.companyName);

		const companyWebsite = pickString(
			companyEntry?.companyWebsite,
			row.companyWebsite,
			row.companyUrl
		);

		const companyLinkedinUrl = pickString(
			companyEntry?.companyLinkedinUrl,
			row.companyLinkedinUrl
		);

		const companyUrl = companyWebsite ?? companyLinkedinUrl;
		const companyDomain = normalizeCompanyDomain(companyWebsite ?? companyUrl);

		const emailCandidates = [
			row.email,
			row.contactInfo?.email,
			...readStringArray(row.emails),
			...readStringArray(row.contactInfo?.emails),
		];

		const email = pickFirstEmail(...emailCandidates);

		const location = pickLocation(row.location);

		const externalId =
			pickString(row.id) ??
			linkedinUrl ??
			(typeof row.publicIdentifier === "string"
				? `public:${row.publicIdentifier}`
				: undefined);

		return {
			source: LeadProvider.APIFY,
			externalId: externalId,

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
