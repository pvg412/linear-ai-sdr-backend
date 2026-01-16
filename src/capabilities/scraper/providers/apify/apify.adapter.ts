import { injectable } from "inversify";
import { LeadProvider } from "@prisma/client";

import type {
	ApifyScraperQuery,
	ScraperAdapter,
	ScraperStartResult,
	ScraperStatusResult,
} from "@/capabilities/scraper/scraper.dto";
import {
	dedupeLeads,
	validateNormalizedLeads,
	type NormalizedLead,
} from "@/capabilities/shared/leadValidate";
import { UserFacingError } from "@/infra/userFacingError";

import {
	ApifyLinkedinProfileSearchClient,
	type ApifyLinkedinProfileSearchInput,
} from "./apify.client";
import { mapApifyLinkedinRowsToLeads } from "./apify.leadMapper";
import { wrapApifyError } from "./apify.errors";
import { ApifyActorRunSchema } from "./apify.schemas";

@injectable()
export class ApifyScraperAdapter implements ScraperAdapter {
	public readonly provider = LeadProvider.APIFY;

	// 1 minute
	public readonly pollIntervalMs = 60 * 1000;

	// 180 * 1min = 3 hours
	public readonly maxPollAttempts = 180;

	private readonly client: ApifyLinkedinProfileSearchClient;

	constructor(
		private readonly token: string,
		private readonly enabled: boolean,
		private readonly mongodbConnectionString: string
	) {
		this.client = new ApifyLinkedinProfileSearchClient(token);
	}

	isEnabled(): boolean {
		return this.enabled && !!this.token;
	}

	async start(query: ApifyScraperQuery): Promise<ScraperStartResult> {
		try {
			assertApifyLimit(query.limit, query.autoQuerySegmentation);
			const inputBase = buildApifyInput(query);
			const input = applyApifyMongoDedupAndPostFilters(
				inputBase,
				query,
				this.mongodbConnectionString
			);
			ensureApifySearchInput(input);

			const run = await this.client.start(input);

			return {
				providerRunId: run.id,
				fileNameHint: `apify-${run.id}.json`,
			};
		} catch (e) {
			wrapApifyError(e);
			throw e;
		}
	}

	async checkStatus(providerRunId: string): Promise<ScraperStatusResult> {
		try {
			const run = await this.client.getRun(providerRunId);
			const status = String(run.status ?? "").toUpperCase();
			const statusMessage = String(run.statusMessage ?? "").toLowerCase();
			const isRateLimited =
				statusMessage.includes("rate limited") ||
				statusMessage.includes("rate limit");

			// Actor may report SUCCEEDED while being rate-limited mid-run (partial dataset).
			// In this case we mark it FAILED so the orchestrator can retry/resume later.
			if (status === "SUCCEEDED" && isRateLimited) {
				return {
					status: "FAILED",
					raw: {
						...(run as Record<string, unknown>),
						_hint: "RATE_LIMITED_PARTIAL",
					},
				};
			}

			if (status === "SUCCEEDED") {
				return { status: "SUCCEEDED", raw: run };
			}
			if (
				status === "FAILED" ||
				status === "ABORTED" ||
				status === "TIMED-OUT"
			) {
				return { status: "FAILED", raw: run };
			}

			return { status: "RUNNING", raw: run };
		} catch (e) {
			wrapApifyError(e);
			throw e;
		}
	}

	async fetchLeads(input: {
		providerRunId: string;
		query: ApifyScraperQuery;
		status?: ScraperStatusResult;
	}): Promise<NormalizedLead[]> {
		try {
			assertApifyLimit(input.query.limit, input.query.autoQuerySegmentation);
			const statusObj: unknown = input.status?.raw;
			const parsed = statusObj
				? ApifyActorRunSchema.safeParse(statusObj)
				: { success: false as const };

			const run = parsed.success
				? parsed.data
				: await this.client.getRun(input.providerRunId);

			const datasetId = run.defaultDatasetId;
			if (!datasetId) {
				throw new Error(
					`Apify run ${input.providerRunId} has no defaultDatasetId`
				);
			}

			const rows = await this.client.listDatasetItems(
				datasetId,
				input.query.limit
			);

			const leadsRaw = mapApifyLinkedinRowsToLeads(rows);
			const leadsValidated = validateNormalizedLeads(leadsRaw, {
				mode: "drop",
				provider: LeadProvider.APIFY,
				minValid: 0,
			});

			const leadsUnique = dedupeLeads(leadsValidated);
			return leadsUnique.slice(0, input.query.limit);
		} catch (e) {
			wrapApifyError(e);
			throw e;
		}
	}
}

const APIFY_HARD_LIMIT = 2500;
const APIFY_MAX_WITH_SEGMENTATION = 100_000;
const RESULTS_PER_PAGE = 25;
const MAX_TAKE_PAGES = 100;
const ALLOWED_PROFILE_SCRAPER_MODES = new Set([
	"Short",
	"Full",
	"Full + email search",
]);

function assertApifyLimit(
	limit: number,
	autoQuerySegmentation?: boolean
): void {
	const n = Math.max(1, Math.floor(limit));

	if (autoQuerySegmentation) {
		if (n <= APIFY_MAX_WITH_SEGMENTATION) return;

		throw new UserFacingError({
			code: "APIFY_LIMIT_TOO_HIGH",
			userMessage:
				`Limit ${n} too high.\n` +
				`With autoQuerySegmentation the safe max is ${APIFY_MAX_WITH_SEGMENTATION}.\n`,
			debugMessage: `limit=${n} exceeds APIFY_MAX_WITH_SEGMENTATION=${APIFY_MAX_WITH_SEGMENTATION}`,
		});
	}

	if (n <= APIFY_HARD_LIMIT) return;

	throw new UserFacingError({
		code: "APIFY_LIMIT_TOO_HIGH",
		userMessage:
			`Limit ${n} too high for a single LinkedIn query.\n` +
			`Enable autoQuerySegmentation or keep <= ${APIFY_HARD_LIMIT}.\n`,
		debugMessage: `limit=${n} exceeds APIFY_HARD_LIMIT=${APIFY_HARD_LIMIT}`,
	});
}

function normalizeProfileScraperMode(mode: string | undefined): string {
	const m = (mode ?? "Full").trim();
	if (ALLOWED_PROFILE_SCRAPER_MODES.has(m)) return m;

	throw new UserFacingError({
		code: "APIFY_INVALID_MODE",
		userMessage:
			`Invalid profileScraperMode: ${m}\n` +
			`Allowed: Short | Full | Full + email search\n`,
		debugMessage: `profileScraperMode=${m}`,
	});
}

function normalizeStringArray(values?: string[] | null): string[] {
	if (!Array.isArray(values)) return [];
	const out: string[] = [];
	for (const v of values) {
		if (typeof v !== "string") continue;
		const trimmed = v.trim();
		if (trimmed) out.push(trimmed);
	}
	return out;
}

function quoteForLinkedin(term: string): string {
	const trimmed = term.trim();
	if (!trimmed) return "";

	const hasBoolean = /\b(AND|OR|NOT)\b/.test(trimmed);
	const hasParens = /[()]/.test(trimmed);
	const hasQuotes = /"/.test(trimmed);

	if (hasBoolean || hasParens || hasQuotes) return trimmed;
	if (/\s/.test(trimmed)) return `"${trimmed}"`;
	return trimmed;
}

function buildOrGroup(values: string[]): string | undefined {
	const cleaned = values.map(quoteForLinkedin).filter(Boolean);
	if (cleaned.length === 0) return undefined;
	if (cleaned.length === 1) return cleaned[0];
	return `(${cleaned.join(" OR ")})`;
}

function buildSearchQuery(query: ApifyScraperQuery): string | undefined {
	const explicit =
		typeof query.searchQuery === "string" ? query.searchQuery.trim() : "";
	if (explicit) return explicit;

	const groups: string[] = [];

	const keywords = buildOrGroup(normalizeStringArray(query.companyKeywords));
	if (keywords) groups.push(keywords);

	const industry =
		typeof query.industry === "string" ? quoteForLinkedin(query.industry) : "";
	if (industry) groups.push(industry);

	return groups.length > 0 ? groups.join(" AND ") : undefined;
}

function calcTakePages(limit: number): number {
	const pages = Math.ceil(limit / RESULTS_PER_PAGE);
	return Math.max(1, Math.min(MAX_TAKE_PAGES, pages));
}

function buildApifyInput(
	query: ApifyScraperQuery
): ApifyLinkedinProfileSearchInput {
	const titles = normalizeStringArray(query.titles);
	const pastJobTitles = normalizeStringArray(query.pastJobTitles);

	const locations = normalizeStringArray(query.locations);
	const excludeLocations = normalizeStringArray(query.excludeLocations);

	const currentCompanies = normalizeStringArray(query.currentCompanies);
	const pastCompanies = normalizeStringArray(query.pastCompanies);
	const excludeCurrentCompanies = normalizeStringArray(
		query.excludeCurrentCompanies
	);
	const excludePastCompanies = normalizeStringArray(query.excludePastCompanies);

	const schools = normalizeStringArray(query.schools);
	const excludeSchools = normalizeStringArray(query.excludeSchools);

	const excludeCurrentJobTitles = normalizeStringArray(
		query.excludeCurrentJobTitles
	);
	const excludePastJobTitles = normalizeStringArray(query.excludePastJobTitles);

	const industryIds = normalizeStringArray(query.industryIds);
	const excludeIndustryIds = normalizeStringArray(query.excludeIndustryIds);

	const seniorityLevelIds = normalizeStringArray(query.seniorityLevelIds);
	const excludeSeniorityLevelIds = normalizeStringArray(
		query.excludeSeniorityLevelIds
	);

	const functionIds = normalizeStringArray(query.functionIds);
	const excludeFunctionIds = normalizeStringArray(query.excludeFunctionIds);

	const yearsOfExperienceIds = normalizeStringArray(
		query.yearsOfExperienceIds
	) as ("1" | "2" | "3" | "4" | "5")[];
	const yearsAtCurrentCompanyIds = normalizeStringArray(
		query.yearsAtCurrentCompanyIds
	) as ("1" | "2" | "3" | "4" | "5")[];

	const firstNames = normalizeStringArray(query.firstNames);
	const lastNames = normalizeStringArray(query.lastNames);
	const profileLanguages = normalizeStringArray(query.profileLanguages);

	const searchQuery = buildSearchQuery(query);

	const segLevels = normalizeStringArray(query.autoQuerySegmentationLevels);
	const segCountries = normalizeStringArray(
		query.autoQuerySegmentationTargetCountries
	).map((c) => c.toUpperCase());

	const startPage =
		typeof query.startPage === "number" && Number.isFinite(query.startPage)
			? Math.max(1, Math.min(100, Math.floor(query.startPage)))
			: undefined;

	// Prefer explicit takePages, otherwise compute from limit (clamped to 100 by calcTakePages)
	const takePages =
		typeof query.takePages === "number" && Number.isFinite(query.takePages)
			? Math.max(0, Math.min(100, Math.floor(query.takePages)))
			: calcTakePages(query.limit);

	if (searchQuery && searchQuery.length > 300) {
		throw new UserFacingError({
			code: "APIFY_SEARCHQUERY_TOO_LONG",
			userMessage: "LinkedIn Boolean query must be <= 300 characters.",
			debugMessage: `len=${searchQuery.length}`,
		});
	}

	return {
		searchQuery,
		maxItems: Math.max(1, Math.floor(query.limit)),

		locations: locations.length ? locations : undefined,
		excludeLocations: excludeLocations.length ? excludeLocations : undefined,

		currentCompanies: currentCompanies.length ? currentCompanies : undefined,
		pastCompanies: pastCompanies.length ? pastCompanies : undefined,
		excludeCurrentCompanies: excludeCurrentCompanies.length
			? excludeCurrentCompanies
			: undefined,
		excludePastCompanies: excludePastCompanies.length
			? excludePastCompanies
			: undefined,

		schools: schools.length ? schools : undefined,
		excludeSchools: excludeSchools.length ? excludeSchools : undefined,

		currentJobTitles: titles.length ? titles : undefined,
		pastJobTitles: pastJobTitles.length ? pastJobTitles : undefined,
		excludeCurrentJobTitles: excludeCurrentJobTitles.length
			? excludeCurrentJobTitles
			: undefined,
		excludePastJobTitles: excludePastJobTitles.length
			? excludePastJobTitles
			: undefined,

		yearsOfExperienceIds: yearsOfExperienceIds.length
			? yearsOfExperienceIds
			: undefined,
		yearsAtCurrentCompanyIds: yearsAtCurrentCompanyIds.length
			? yearsAtCurrentCompanyIds
			: undefined,

		seniorityLevelIds: seniorityLevelIds.length ? seniorityLevelIds : undefined,
		excludeSeniorityLevelIds: excludeSeniorityLevelIds.length
			? excludeSeniorityLevelIds
			: undefined,

		functionIds: functionIds.length ? functionIds : undefined,
		excludeFunctionIds: excludeFunctionIds.length
			? excludeFunctionIds
			: undefined,

		industryIds: industryIds.length ? industryIds : undefined,
		excludeIndustryIds: excludeIndustryIds.length
			? excludeIndustryIds
			: undefined,

		firstNames: firstNames.length ? firstNames : undefined,
		lastNames: lastNames.length ? lastNames : undefined,
		profileLanguages: profileLanguages.length ? profileLanguages : undefined,

		recentlyChangedJobs:
			typeof query.recentlyChangedJobs === "boolean"
				? query.recentlyChangedJobs
				: undefined,

		startPage,
		takePages,

		autoQuerySegmentation: query.autoQuerySegmentation,
		autoQuerySegmentationLevels: segLevels.length ? segLevels : undefined,
		autoQuerySegmentationTargetCountries: segCountries.length
			? segCountries
			: undefined,

		// Dedup + post-filtering are set later
		profileScraperMode: normalizeProfileScraperMode(query.profileScraperMode),
	};
}

function ensureApifySearchInput(input: ApifyLinkedinProfileSearchInput): void {
	const hasSearchQuery =
		typeof input.searchQuery === "string" &&
		input.searchQuery.trim().length > 0;
	const hasIncludeArrays =
		(input.currentJobTitles?.length ?? 0) > 0 ||
		(input.pastJobTitles?.length ?? 0) > 0 ||
		(input.locations?.length ?? 0) > 0 ||
		(input.currentCompanies?.length ?? 0) > 0 ||
		(input.pastCompanies?.length ?? 0) > 0 ||
		(input.schools?.length ?? 0) > 0 ||
		(input.yearsOfExperienceIds?.length ?? 0) > 0 ||
		(input.yearsAtCurrentCompanyIds?.length ?? 0) > 0 ||
		(input.seniorityLevelIds?.length ?? 0) > 0 ||
		(input.functionIds?.length ?? 0) > 0 ||
		(input.industryIds?.length ?? 0) > 0 ||
		(input.firstNames?.length ?? 0) > 0 ||
		(input.lastNames?.length ?? 0) > 0 ||
		(input.profileLanguages?.length ?? 0) > 0;

	const hasRecentlyChangedJobs = input.recentlyChangedJobs === true;

	if (hasSearchQuery || hasIncludeArrays || hasRecentlyChangedJobs) return;

	throw new UserFacingError({
		code: "APIFY_MISSING_QUERY",
		userMessage:
			"Apify search needs a search query, titles, or locations.\n" +
			"Please update your scraper filters.\n",
		debugMessage:
			"Apify input missing searchQuery and all include filters (exclude-only is not supported).",
	});
}

function applyApifyMongoDedupAndPostFilters(
	input: ApifyLinkedinProfileSearchInput,
	query: ApifyScraperQuery,
	mongoConn: string
): ApifyLinkedinProfileSearchInput {
	const out: ApifyLinkedinProfileSearchInput = {
		...input,
		// 1:1 из query
		postFilteringMongoDbQuery: query.postFilteringMongoDbQuery,
		postFilteringMongoDbAggregation: query.postFilteringMongoDbAggregation,
	};

	// dedupe boolean -> default mode is "insert_ids" (explicit mode wins)
	const mode =
		query.profileDeduplicationMode ??
		(query.dedupe === false ? "off" : "insert_ids");

	if (mode === "off") return out;

	const mongo = (mongoConn ?? "").trim();
	if (!mongo) {
		throw new UserFacingError({
			code: "APIFY_MISSING_MONGODB",
			userMessage:
				"Apify deduplication enabled but MongoDB is not configured.\n" +
				"Set APIFY_MONGODB_CONNECTION_STRING on the server.\n",
			debugMessage: `dedupe requested, profileDeduplicationMode=${mode}`,
		});
	}

	out.profileDeduplicationMode = mode;
	out.mongoDbConnectionString = mongo;
	return out;
}
