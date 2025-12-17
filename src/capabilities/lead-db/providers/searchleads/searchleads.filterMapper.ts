import { ScraperProvider } from "@prisma/client";
import type {
	LeadDbCanonicalFilters,
	LeadDbQuery,
} from "@/capabilities/lead-db/lead-db.dto";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function trimString(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	const t = v.trim();
	return t.length ? t : undefined;
}

function stringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out = v
		.filter((x): x is string => typeof x === "string")
		.map((x) => x.trim())
		.filter((x) => x.length > 0);
	return out.length ? out : undefined;
}

function firstDefined<T>(...vals: Array<T | undefined>): T | undefined {
	for (const v of vals) if (v !== undefined) return v;
	return undefined;
}

/**
 * SearchLeads filter format is huge; we keep only fields we set + allow extra keys.
 */
export interface SearchLeadsFilter {
	page?: number;
	per_page?: number;

	person_titles?: string[];
	include_similar_titles?: boolean;

	person_seniorities?: string[];
	person_department_or_subdepartments?: string[];

	organization_num_employees_ranges?: string[];
	organization_industry_display_name?: string[];

	company_level_keyword?: {
		sources?: Array<{ mode?: string; source?: string }>;
		content?: string[];
	};

	person_level_keyword?: {
		sources?: Array<{ mode?: string; source?: string }>;
		content?: string[];
	};

	person_locations?: Array<{
		name?: string;
		countryCode?: string;
		stateCode?: string;
	}>;

	company_locations?: Array<{
		name?: string;
		countryCode?: string;
		stateCode?: string;
	}>;

	fields?: string[];

	[key: string]: unknown;
}

export interface SearchLeadsCreateExportRequest {
	filter: SearchLeadsFilter;
	noOfLeads: number;
	fileName: string;
}

/**
 * providerOverrides[SEARCH_LEADS] is treated as a FILTER override (not full request),
 * because we still enforce `noOfLeads` + `fileName`.
 */
export function buildSearchLeadsCreateExportRequest(query: LeadDbQuery): {
	payload: SearchLeadsCreateExportRequest;
	fileName: string;
	noOfLeads: number;
} {
	const noOfLeads = normalizeNoOfLeads(query.limit);
	const fileName = normalizeFileName(query.fileName) ?? `search_${Date.now()}`;

	const override = query.providerOverrides?.[ScraperProvider.SEARCH_LEADS];
	if (isRecord(override)) {
		const filter = sanitizeFilter(override as SearchLeadsFilter, noOfLeads);
		return {
			payload: { filter, noOfLeads, fileName },
			fileName,
			noOfLeads,
		};
	}

	const canonical: LeadDbCanonicalFilters | undefined = query.filters;

	// legacy apolloFilters is Record<string, unknown> already
	const legacy: UnknownRecord | undefined = isRecord(query.apolloFilters)
		? query.apolloFilters
		: undefined;

	// canonical wins; legacy is fallback
	const personTitles = firstDefined(
		canonical?.personTitles,
		stringArray(legacy?.personTitles)
	);

	const seniorityLevel = firstDefined(
		canonical?.seniorityLevel,
		trimString(legacy?.seniorityLevel)
	);

	const functionDept = firstDefined(
		canonical?.functionDept,
		trimString(legacy?.functionDept)
	);

	const companyIndustry = firstDefined(
		canonical?.companyIndustry,
		trimString(legacy?.companyIndustry)
	);

	const companyKeywords = firstDefined(
		canonical?.companyKeywords,
		stringArray(legacy?.companyKeywords)
	);

	const personCountry = firstDefined(
		canonical?.personCountry,
		trimString(legacy?.personCountry)
	);

	const companyCountry = firstDefined(
		canonical?.companyCountry,
		trimString(legacy?.companyCountry)
	);

	const companySize = firstDefined(
		canonical?.companySize,
		trimString(legacy?.companySize)
	);

	const filter = mapToSearchLeadsFilter(
		{
			personTitles,
			seniorityLevel,
			functionDept,
			companyIndustry,
			companyKeywords,
			personCountry,
			companyCountry,
			companySize,
		},
		noOfLeads
	);

	return {
		payload: { filter, noOfLeads, fileName },
		fileName,
		noOfLeads,
	};
}

function mapToSearchLeadsFilter(
	input: {
		personTitles?: string[];
		seniorityLevel?: string;
		functionDept?: string;
		companyIndustry?: string;
		companyKeywords?: string[];
		personCountry?: string;
		companyCountry?: string;
		companySize?: string;
	},
	noOfLeads: number
): SearchLeadsFilter {
	const filter: SearchLeadsFilter = {
		page: 1,
		per_page: Math.min(100, noOfLeads),
		include_similar_titles: true,

		...(input.personTitles?.length
			? { person_titles: input.personTitles }
			: {}),

		...(input.seniorityLevel
			? { person_seniorities: [input.seniorityLevel] }
			: {}),

		...(input.functionDept
			? { person_department_or_subdepartments: [input.functionDept] }
			: {}),

		...(input.companyIndustry
			? { organization_industry_display_name: [input.companyIndustry] }
			: {}),

		...(input.companyKeywords?.length
			? { company_level_keyword: { content: input.companyKeywords } }
			: {}),

		...(input.companySize
			? { organization_num_employees_ranges: [input.companySize] }
			: {}),

		...(input.personCountry
			? { person_locations: [{ name: input.personCountry }] }
			: {}),

		...(input.companyCountry
			? { company_locations: [{ name: input.companyCountry }] }
			: {}),
	};

	return sanitizeFilter(filter, noOfLeads);
}

function sanitizeFilter(
	filter: SearchLeadsFilter,
	noOfLeads: number
): SearchLeadsFilter {
	const out: SearchLeadsFilter = { ...filter };

	const page = typeof out.page === "number" ? out.page : 1;
	const per =
		typeof out.per_page === "number" ? out.per_page : Math.min(100, noOfLeads);

	out.page = Math.max(1, Math.floor(page));
	out.per_page = Math.max(1, Math.min(500, Math.floor(per)));

	return out;
}

function normalizeNoOfLeads(limit: number): number {
	const n = Number.isFinite(limit) ? Math.floor(limit) : 100;
	return Math.max(1, n);
}

function normalizeFileName(fileName?: string): string | undefined {
	const trimmed = (fileName ?? "").trim();
	if (!trimmed) return undefined;
	return trimmed.slice(0, 80);
}
