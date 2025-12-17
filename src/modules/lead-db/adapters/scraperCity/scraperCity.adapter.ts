import axios, { AxiosError } from "axios";
import { injectable } from "inversify";
import { LeadSource, ScraperProvider } from "@prisma/client";

import { loadEnv } from "@/config/env";
import type {
	LeadDbAdapter,
	LeadDbAdapterResult,
	LeadDbQuery,
	NormalizedLeadForCreate,
} from "@/modules/lead-db/lead-db.dto";
import type {
	ScraperCityApolloRow,
	ScraperCityStartResponse,
	ScraperCityStatusResponse,
} from "./scraperCity.dto";
import { resolveScraperCityPersonTitles } from "./scraperCity.personTitlesResolver";
import { resolveScraperCitySeniorityLevel } from "./scraperCity.seniorityResolver";
import { SCRAPERCITY_ALLOWED_SENIORITY_LEVELS } from "./scraperCity.allowedSeniority";
import {
	mergeKeywords,
	industryToKeywordTokens,
	resolveScraperCityCompanyIndustry,
	shouldMoveIndustryToKeywords,
} from "./scraperCity.companyIndustryResolver";
import { UserFacingError } from "@/infra/userFacingError";
import { SCRAPERCITY_ALLOWED_COMPANY_INDUSTRIES } from "./scraperCity.allowedIndustries";

const env = loadEnv();

@injectable()
export class ScraperCityLeadDbAdapter implements LeadDbAdapter {
	public readonly provider = ScraperProvider.SCRAPER_CITY;

	private readonly startEndpoint = `${env.SCRAPERCITY_API_URL}/v1/scrape/apollo-filters`;

	constructor(
		private readonly apiKey: string,
		private readonly enabled: boolean
	) {}

	isEnabled(): boolean {
		return this.enabled && !!this.apiKey;
	}

	async scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult> {
		const { payload, count, fileName } = this.buildScrapePayload(query);

		try {
			// Helpful runtime visibility (payload may contain user-provided filters)
			console.info("[ScraperCityLeadDb] scrape payload", {
				count,
				fileName,
				payload,
			});

			const runId = await this.startRun(payload);
			const status = await this.waitForRun(runId);
			const rows = await this.downloadRows(runId, status);
			const leads = this.mapRowsToLeads(rows);

			return {
				provider: this.provider,
				providerRunId: runId,
				fileNameHint: fileName
					? `${fileName}.json`
					: `scrapercity-${runId}.json`,
				leads,
			};
		} catch (e) {
			this.logAndRethrowIfUserFacingAxiosError(e);
			throw e; // Preserve original error for upstream handling
		}
	}

	private buildScrapePayload(query: LeadDbQuery): {
		payload: Record<string, unknown>;
		count: number;
		fileName?: string;
	} {
		const count = this.normalizeCount(query.limit);
		const fileName = this.normalizeFileName(query.fileName);

		const apolloFilters = query.apolloFilters ?? {};
		const {
			personTitles,
			seniorityLevel,
			companyIndustry,
			companyKeywords,
			restApollo,
		} = this.sanitizeApolloFilters(apolloFilters);

		const payload: Record<string, unknown> = {
			...restApollo,
			...(personTitles.length > 0 ? { personTitles } : {}), // omit if empty
			...(seniorityLevel ? { seniorityLevel } : {}),
			...(companyIndustry ? { companyIndustry } : {}),
			...(companyKeywords ? { companyKeywords } : {}),
			count,
			...(fileName ? { fileName } : {}),
		};

		return { payload, count, fileName };
	}

	private sanitizeApolloFilters(
		apolloFilters: NonNullable<LeadDbQuery["apolloFilters"]>,
	): {
		personTitles: string[];
		seniorityLevel?: string;
		companyIndustry?: string;
		companyKeywords?: string[];
		restApollo: Record<string, unknown>;
	} {
		// IMPORTANT: never spread raw apolloFilters directly, otherwise invalid fields
		// (e.g. companyIndustry) will leak into the payload.
		const restApollo: Record<string, unknown> = {
			...(apolloFilters as Record<string, unknown>),
		};

		const requestedTitles = apolloFilters.personTitles;
		const { resolved, unmapped, mapping } =
			resolveScraperCityPersonTitles(requestedTitles);

		// If user asked for titles but none are resolvable -> fail fast
		if (
			Array.isArray(requestedTitles) &&
			requestedTitles.length > 0 &&
			resolved.length === 0
		) {
			throw new UserFacingError({
				code: "SCRAPERCITY_INVALID_TITLES",
				userMessage:
					`Some titles are not supported by ScraperCity: ${unmapped.join(", ")}.\n` +
					`Try full titles (e.g. "Chief Technology Officer") or select other titles.`,
			});
		}

		if (unmapped.length > 0) {
			console.warn("[ScraperCityLeadDb] dropped unsupported personTitles", {
				unmapped,
				mapping,
			});
		}

		const requestedSeniority = apolloFilters.seniorityLevel;
		const seniorityLevel =
			resolveScraperCitySeniorityLevel(requestedSeniority);

		if (requestedSeniority && !seniorityLevel) {
			throw new UserFacingError({
				code: "SCRAPERCITY_INVALID_SENIORITY",
				userMessage:
					`Invalid seniorityLevel: "${requestedSeniority}". ` +
					`Allowed values: ${SCRAPERCITY_ALLOWED_SENIORITY_LEVELS.join(", ")}`,
			});
		}

		const requestedIndustry = apolloFilters.companyIndustry;
		const resolvedIndustry =
			resolveScraperCityCompanyIndustry(requestedIndustry);

		let companyKeywords = apolloFilters.companyKeywords;

		const moveIndustryToKeywords =
			!!requestedIndustry &&
			(!resolvedIndustry || shouldMoveIndustryToKeywords(requestedIndustry));

		if (moveIndustryToKeywords) {
			companyKeywords = mergeKeywords(
				companyKeywords,
				industryToKeywordTokens(requestedIndustry),
			);
			console.warn(
				"[ScraperCityLeadDb] dropped unsupported companyIndustry, moved to companyKeywords",
				{
					requestedIndustry,
				},
			);
		}

		// Remove fields we explicitly sanitize above
		delete restApollo.personTitles;
		delete restApollo.seniorityLevel;
		delete restApollo.companyIndustry;
		delete restApollo.companyKeywords;

		return {
			personTitles: resolved,
			seniorityLevel,
			companyIndustry:
				resolvedIndustry && !moveIndustryToKeywords ? resolvedIndustry : undefined,
			companyKeywords,
			restApollo,
		};
	}

	private async startRun(payload: Record<string, unknown>): Promise<string> {
		console.info("[ScraperCityLeadDb] starting scrape run", {
			endpoint: this.startEndpoint,
		});

		const startRes = await axios.post<ScraperCityStartResponse>(
			this.startEndpoint,
			payload,
			{
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				timeout: 60_000,
			},
		);

		const runId = startRes.data.runId;
		console.info("[ScraperCityLeadDb] run started", { runId });
		return runId;
	}

	private async waitForRun(runId: string): Promise<ScraperCityStatusResponse> {
		console.info("[ScraperCityLeadDb] waiting for run to finish", { runId });
		return this.waitUntilFinished(runId, {
			intervalMs: 5_000,
			maxAttempts: 180,
		});
	}

	private async downloadRows(
		runId: string,
		status: ScraperCityStatusResponse,
	): Promise<ScraperCityApolloRow[]> {
		const downloadUrl = this.buildDownloadUrl(runId, status.outputUrl);

		console.info("[ScraperCityLeadDb] run finished, downloading result", {
			runId,
			status: status.status,
			downloadUrl,
		});

		const downloadRes = await axios.get<ScraperCityApolloRow[]>(downloadUrl, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			timeout: 120_000,
		});

		const rows = Array.isArray(downloadRes.data) ? downloadRes.data : [];

		console.info("[ScraperCityLeadDb] download complete", {
			runId,
			rows: rows.length,
		});

		return rows;
	}

	private mapRowsToLeads(rows: ScraperCityApolloRow[]): NormalizedLeadForCreate[] {
		return rows.map((row) => ({
			source: LeadSource.APOLLO,
			externalId: row.id ?? undefined,

			fullName: row.name ?? undefined,
			firstName: row.first_name ?? undefined,
			lastName: row.last_name ?? undefined,
			title: row.title ?? undefined,
			company: row.company_name ?? undefined,
			companyDomain: row.company_domain ?? undefined,
			companyUrl: row.company_website ?? undefined,
			linkedinUrl: row.linkedin_url ?? undefined,
			location: row.location ?? undefined,

			email: row.work_email ?? row.email ?? undefined,
			raw: row,
		}));
	}

	private logAndRethrowIfUserFacingAxiosError(e: unknown): void {
		if (!(e instanceof AxiosError)) {
			console.error("[ScraperCityLeadDb] error", (e as Error).message);
			return;
		}

		console.error("[ScraperCityLeadDb] error response", {
			status: e.response?.status,
			data: e.response?.data as unknown,
			request: {
				method: e.config?.method,
				url: e.config?.url,
				params: e.config?.params as unknown,
				data: e.config?.data as unknown,
			},
		});

		const status = e.response?.status;
		const providerMessage = this.extractProviderErrorMessage(e.response?.data);

		if (status === 400 && providerMessage?.includes("invalid-input")) {
			// Provide relevant examples (the full allowlist is large).
			const examples = [
				"Computer Software",
				"Information Technology & Services",
				"Internet",
				"Computer & Network Security",
				"Financial Services",
				"Venture Capital & Private Equity",
			].filter((x) =>
				SCRAPERCITY_ALLOWED_COMPANY_INDUSTRIES.includes(
					x as (typeof SCRAPERCITY_ALLOWED_COMPANY_INDUSTRIES)[number],
				),
			);

			throw new UserFacingError({
				code: "SCRAPERCITY_INVALID_INPUT",
				userMessage:
					`ScraperCity rejected filters (invalid input).\n` +
					`Check industry/seniority/titles. Examples of allowed industry: ${examples.join(", ")}.\n`,
				debugMessage: `ScraperCity invalid-input: ${providerMessage}`,
				details: { status, providerMessage },
			});
		}
	}

	private extractProviderErrorMessage(data: unknown): string | undefined {
		const maybe =
			(data as { error?: { message?: unknown } } | undefined)?.error?.message;
		return typeof maybe === "string" ? String(maybe) : undefined;
	}

	private normalizeCount(limit: number): number {
		const min = 500;
		const max = 50_000;
		const n = Number.isFinite(limit) ? Math.floor(limit) : min;
		if (n < min) return min;
		if (n > max) return max;
		return n;
	}

	private normalizeFileName(fileName?: string): string | undefined {
		const trimmed = (fileName ?? "").trim();
		if (!trimmed) return undefined;
		return trimmed.slice(0, 50);
	}

	private async waitUntilFinished(
		runId: string,
		opts: { intervalMs: number; maxAttempts: number }
	): Promise<ScraperCityStatusResponse> {
		console.info("[ScraperCityLeadDb] polling run status", {
			runId,
			intervalMs: opts.intervalMs,
			maxAttempts: opts.maxAttempts,
		});

		let lastStatus: string | undefined;

		for (let i = 0; i < opts.maxAttempts; i++) {
			const statusUrl = `${env.SCRAPERCITY_API_URL}/v1/scrape/status/${runId}`;

			const statusRes = await axios.get<ScraperCityStatusResponse>(
				statusUrl,
				{
					headers: { Authorization: `Bearer ${this.apiKey}` },
					timeout: 30_000,
				}
			);

			const status = String(statusRes.data.status ?? "").toUpperCase();

			// Log on first poll and on status changes (keeps logs useful but not too noisy)
			if (i === 0 || status !== lastStatus) {
				console.debug("[ScraperCityLeadDb] run status", {
					runId,
					statusUrl,
					attempt: i + 1,
					maxAttempts: opts.maxAttempts,
					status,
				});
			}

			lastStatus = status;

			if (status === "SUCCEEDED") {
				console.info("[ScraperCityLeadDb] run succeeded", {
					runId,
					attempts: i + 1,
				});
				return statusRes.data;
			}
			if (status === "FAILED") {
				throw new Error(`ScraperCity run failed: ${runId}`);
			}

			await new Promise((r) => setTimeout(r, opts.intervalMs));
		}

		throw new Error(`ScraperCity run timed out: ${runId}`);
	}

	private buildDownloadUrl(runId: string, outputUrl?: string | null): string {
		if (!env.SCRAPERCITY_API_URL) {
			throw new Error("SCRAPERCITY_API_URL is not set");
		}

		if (outputUrl) {
			const origin = new URL(env.SCRAPERCITY_API_URL).origin;
			const path = outputUrl.startsWith("/") ? outputUrl : `/${outputUrl}`;
			const sep = path.includes("?") ? "&" : "?";
			return `${origin}${path}${sep}format=json`;
		}
		return `${env.SCRAPERCITY_API_URL}/downloads/${runId}?format=json`;
	}
}
