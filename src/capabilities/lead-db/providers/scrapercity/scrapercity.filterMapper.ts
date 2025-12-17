import { ScraperProvider } from "@prisma/client";
import type { LeadDbQuery } from "@/capabilities/lead-db/lead-db.dto";
import { UserFacingError } from "@/infra/userFacingError";

import { resolveScraperCityPersonTitles } from "./resolvers/scrapercity.personTitles.resolver";
import { resolveScraperCitySeniorityLevel } from "./resolvers/scrapercity.seniority.resolver";
import { SCRAPERCITY_ALLOWED_SENIORITY_LEVELS } from "./allowlists/scrapercity.allowedSeniority";
import {
	mergeKeywords,
	industryToKeywordTokens,
	resolveScraperCityCompanyIndustry,
	shouldMoveIndustryToKeywords,
} from "./resolvers/scrapercity.companyIndustry.resolver";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstNonNullish(...vals: unknown[]): unknown {
	for (const v of vals) if (v !== undefined && v !== null) return v;
	return undefined;
}

// These are intentionally strict-ish helpers (trim, drop empties)
function asString(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	const t = v.trim();
	return t.length ? t : undefined;
}

function asBoolean(v: unknown): boolean | undefined {
	return typeof v === "boolean" ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out = v
		.filter((x): x is string => typeof x === "string")
		.map((x) => x.trim())
		.filter((x) => x.length > 0);
	return out.length ? out : undefined;
}

export interface ScraperCityPayloadBuildResult {
	payload: Record<string, unknown>;
	count: number;
	fileName?: string;
}

export function buildScraperCityPayload(
	query: LeadDbQuery
): ScraperCityPayloadBuildResult {
	const count = normalizeCount(query.limit);
	const fileName = normalizeFileName(query.fileName);

	const override = query.providerOverrides?.[ScraperProvider.SCRAPER_CITY];
	if (isRecord(override)) {
		const payload: Record<string, unknown> = {
			...override,
			count, // enforce our count
			...(fileName ? { fileName } : {}),
		};
		return { payload, count, fileName };
	}

	const filtersRec: UnknownRecord | undefined = isRecord(query.filters)
		? query.filters
		: undefined;
	const legacyRec: UnknownRecord | undefined = isRecord(query.apolloFilters)
		? query.apolloFilters
		: undefined;

	const getRaw = (key: string): unknown =>
		firstNonNullish(filtersRec?.[key], legacyRec?.[key]);

	const personTitlesRaw = getRaw("personTitles");

	if (personTitlesRaw != null && !Array.isArray(personTitlesRaw)) {
		console.warn("[ScraperCityLeadDb] personTitles must be string[]", {
			providedType: typeof personTitlesRaw,
		});
	}

	const personTitles = asStringArray(personTitlesRaw);

	const { resolved, unmapped, mapping } =
		resolveScraperCityPersonTitles(personTitles);

	// Preserve your previous behavior: fail-fast only if array was provided and nothing matched
	if (
		Array.isArray(personTitlesRaw) &&
		(personTitles?.length ?? 0) > 0 &&
		resolved.length === 0
	) {
		throw new UserFacingError({
			code: "SCRAPERCITY_INVALID_TITLES",
			userMessage:
				`Some titles are not supported by ScraperCity: ${unmapped.join(
					", "
				)}.\n` + `Try exact allowed titles like "Chief Technology Officer".`,
			details: { unmapped, mapping },
		});
	}

	if (unmapped.length > 0) {
		console.warn("[ScraperCityLeadDb] dropped unsupported personTitles", {
			unmapped,
			mapping,
		});
	}

	const requestedSeniorityRaw = getRaw("seniorityLevel");

	if (
		requestedSeniorityRaw != null &&
		typeof requestedSeniorityRaw !== "string"
	) {
		throw new UserFacingError({
			code: "SCRAPERCITY_INVALID_SENIORITY",
			userMessage: `Invalid seniorityLevel type. Expected string.`,
			details: { providedType: typeof requestedSeniorityRaw },
		});
	}

	const requestedSeniority = asString(requestedSeniorityRaw);
	const seniorityLevel = resolveScraperCitySeniorityLevel(requestedSeniority);

	if (requestedSeniority && !seniorityLevel) {
		throw new UserFacingError({
			code: "SCRAPERCITY_INVALID_SENIORITY",
			userMessage:
				`Invalid seniorityLevel: "${requestedSeniority}". ` +
				`Allowed values: ${SCRAPERCITY_ALLOWED_SENIORITY_LEVELS.join(", ")}`,
		});
	}

	const requestedIndustryRaw = getRaw("companyIndustry");

	if (
		requestedIndustryRaw != null &&
		typeof requestedIndustryRaw !== "string"
	) {
		throw new UserFacingError({
			code: "SCRAPERCITY_INVALID_INDUSTRY",
			userMessage: `Invalid companyIndustry type. Expected string.`,
			details: { providedType: typeof requestedIndustryRaw },
		});
	}

	const requestedIndustry = asString(requestedIndustryRaw);
	const resolvedIndustry = resolveScraperCityCompanyIndustry(requestedIndustry);

	let companyKeywords = asStringArray(getRaw("companyKeywords"));

	const moveIndustryToKeywords =
		!!requestedIndustry &&
		(!resolvedIndustry || shouldMoveIndustryToKeywords(requestedIndustry));

	if (moveIndustryToKeywords) {
		companyKeywords = mergeKeywords(
			companyKeywords,
			industryToKeywordTokens(requestedIndustry)
		);
		console.warn(
			"[ScraperCityLeadDb] dropped unsupported companyIndustry, moved to companyKeywords",
			{
				requestedIndustry,
			}
		);
	}

	// Safe mapped fields only (as you intended)
	const payload: Record<string, unknown> = {
		...(asString(getRaw("functionDept"))
			? { functionDept: asString(getRaw("functionDept")) }
			: {}),

		...(resolved.length > 0 ? { personTitles: resolved } : {}),
		...(seniorityLevel ? { seniorityLevel } : {}),

		...(asString(getRaw("personCountry"))
			? { personCountry: asString(getRaw("personCountry")) }
			: {}),
		...(asString(getRaw("personState"))
			? { personState: asString(getRaw("personState")) }
			: {}),
		...(asStringArray(getRaw("personCities"))
			? { personCities: asStringArray(getRaw("personCities")) }
			: {}),

		...(asString(getRaw("companyCountry"))
			? { companyCountry: asString(getRaw("companyCountry")) }
			: {}),
		...(asString(getRaw("companyState"))
			? { companyState: asString(getRaw("companyState")) }
			: {}),
		...(asStringArray(getRaw("companyCities"))
			? { companyCities: asStringArray(getRaw("companyCities")) }
			: {}),

		...(asString(getRaw("companySize"))
			? { companySize: asString(getRaw("companySize")) }
			: {}),
		...(asStringArray(getRaw("companyDomains"))
			? { companyDomains: asStringArray(getRaw("companyDomains")) }
			: {}),

		...(asBoolean(getRaw("hasPhone")) !== undefined
			? { hasPhone: asBoolean(getRaw("hasPhone")) }
			: {}),

		...(resolvedIndustry && !moveIndustryToKeywords
			? { companyIndustry: resolvedIndustry }
			: {}),
		...(companyKeywords ? { companyKeywords } : {}),

		count,
		...(fileName ? { fileName } : {}),
	};

	return { payload, count, fileName };
}

function normalizeCount(limit: number): number {
	const min = 500;
	const max = 50_000;
	const n = Number.isFinite(limit) ? Math.floor(limit) : min;
	if (n < min) return min;
	if (n > max) return max;
	return n;
}

function normalizeFileName(fileName?: string): string | undefined {
	const trimmed = (fileName ?? "").trim();
	if (!trimmed) return undefined;
	return trimmed.slice(0, 50);
}
