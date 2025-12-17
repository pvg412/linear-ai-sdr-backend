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
import { UserFacingError } from "@/infra/userFacingError";

import type {
	SearchLeadsCreateExportRequest,
	SearchLeadsCreateExportResponse,
	SearchLeadsFilter,
	SearchLeadsJobStatus,
	SearchLeadsLeadRow,
	SearchLeadsResultResponse,
	SearchLeadsStatusCheckResponse,
} from "./searchLeads.dto";

const env = loadEnv();

@injectable()
export class SearchLeadsLeadDbAdapter implements LeadDbAdapter {
	public readonly provider = ScraperProvider.SEARCH_LEADS;

	private readonly baseUrl =
		env.SEARCH_LEADS_API_URL?.replace(/\/+$/, "") ?? "";
	private readonly exportEndpoint = `${this.baseUrl}/api/export`;

	constructor(
		private readonly apiKey: string,
		private readonly enabled: boolean
	) {}

	isEnabled(): boolean {
		return this.enabled && !!this.apiKey;
	}

	async scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult> {
		const { payload, fileName, noOfLeads } = this.buildExportPayload(query);

		try {
			console.info("[SearchLeadsLeadDb] create export payload", {
				fileName,
				noOfLeads,
				payload,
			});

			const logId = await this.createExport(payload);

			await this.waitForCompletion(logId, {
				intervalMs: 5_000,
				maxAttempts: 240, // 20 minutes
			});

			const rows = await this.getExportResultRows(logId);
			const leads = this.mapRowsToLeads(rows);

			return {
				provider: this.provider,
				providerRunId: logId,
				fileNameHint: `${fileName}.json`,
				leads,
			};
		} catch (e) {
			this.logAndWrapAxiosError(e);
			throw e;
		}
	}

	/**
	 * Build request to POST /api/export
	 *
	 * IMPORTANT: We prefer query.searchLeadsFilter if provided.
	 * If it's missing, we try to map from query.apolloFilters (your internal "generic" filters).
	 */
	private buildExportPayload(query: LeadDbQuery): {
		payload: SearchLeadsCreateExportRequest;
		fileName: string;
		noOfLeads: number;
	} {
		const noOfLeads = this.normalizeNoOfLeads(query.limit);
		const fileName =
			this.normalizeFileName(query.fileName) ?? `search_${Date.now()}`;

		const explicit = (
			query as unknown as { searchLeadsFilter?: SearchLeadsFilter }
		).searchLeadsFilter;

		const filter =
			explicit && typeof explicit === "object"
				? this.sanitizeSearchLeadsFilter(explicit, noOfLeads)
				: this.mapFromApolloFilters(query, noOfLeads);

		const payload: SearchLeadsCreateExportRequest = {
			filter,
			noOfLeads,
			fileName,
		};

		return { payload, fileName, noOfLeads };
	}

	/**
	 * Minimal mapping from your current query.apolloFilters → SearchLeads filter schema.
	 * This keeps backward compatibility while you add AI that can generate SearchLeads-native filter later.
	 */
	private mapFromApolloFilters(
		query: LeadDbQuery,
		noOfLeads: number
	): SearchLeadsFilter {
		const apollo = (query.apolloFilters ?? {}) as Record<string, unknown>;

		const personTitles = Array.isArray(apollo.personTitles)
			? apollo.personTitles.filter(
					(x) => typeof x === "string" && x.trim().length > 0
			  )
			: [];

		const seniorityLevel =
			typeof apollo.seniorityLevel === "string"
				? apollo.seniorityLevel
				: undefined;
		const functionDept =
			typeof apollo.functionDept === "string" ? apollo.functionDept : undefined;

		const companyIndustry =
			typeof apollo.companyIndustry === "string"
				? apollo.companyIndustry
				: undefined;
		const companyKeywords = Array.isArray(apollo.companyKeywords)
			? apollo.companyKeywords.filter(
					(x) => typeof x === "string" && x.trim().length > 0
			  )
			: [];

		// locations (best-effort): allow passing "Germany" etc in `personCountry`
		const personCountry =
			typeof apollo.personCountry === "string"
				? apollo.personCountry
				: undefined;
		const companyCountry =
			typeof apollo.companyCountry === "string"
				? apollo.companyCountry
				: undefined;

		const filter: SearchLeadsFilter = {
			page: 1,
			per_page: Math.min(100, noOfLeads),

			...(personTitles.length ? { person_titles: personTitles } : {}),
			include_similar_titles: true,

			...(seniorityLevel ? { person_seniorities: [seniorityLevel] } : {}),
			...(functionDept
				? { person_department_or_subdepartments: [functionDept] }
				: {}),

			...(companyIndustry
				? { organization_industry_display_name: [companyIndustry] }
				: {}),

			...(companyKeywords.length
				? {
						company_level_keyword: {
							content: companyKeywords,
						},
				  }
				: {}),

			...(personCountry
				? {
						person_locations: [{ name: personCountry }],
				  }
				: {}),

			...(companyCountry
				? {
						company_locations: [{ name: companyCountry }],
				  }
				: {}),
		};

		return filter;
	}

	/**
	 * Keep filter safe: cap page/per_page, and avoid accidentally requesting insane pagination.
	 */
	private sanitizeSearchLeadsFilter(
		filter: SearchLeadsFilter,
		noOfLeads: number
	): SearchLeadsFilter {
		const out: SearchLeadsFilter = { ...filter };

		// Reasonable defaults
		if (typeof out.page !== "number") out.page = 1;
		if (typeof out.per_page !== "number")
			out.per_page = Math.min(100, noOfLeads);

		// Hard caps
		out.page = Math.max(1, Math.floor(out.page));
		out.per_page = Math.max(1, Math.min(500, Math.floor(out.per_page)));

		return out;
	}

	private async createExport(
		payload: SearchLeadsCreateExportRequest
	): Promise<string> {
		const res = await axios.post<SearchLeadsCreateExportResponse>(
			this.exportEndpoint,
			payload,
			{
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				timeout: 60_000,
			}
		);

		const logId = res.data?.log_id;
		if (!logId) {
			throw new Error("SearchLeads: missing log_id in createExport response");
		}

		console.info("[SearchLeadsLeadDb] export created", { logId });
		return logId;
	}

	private async waitForCompletion(
		logId: string,
		opts: { intervalMs: number; maxAttempts: number }
	): Promise<void> {
		console.info("[SearchLeadsLeadDb] polling status", {
			logId,
			intervalMs: opts.intervalMs,
			maxAttempts: opts.maxAttempts,
		});

		let lastStatus: SearchLeadsJobStatus | undefined;

		for (let i = 0; i < opts.maxAttempts; i++) {
			const statusUrl = `${this.baseUrl}/api/logs/statusCheck/${logId}`;

			const res = await axios.get<SearchLeadsStatusCheckResponse>(statusUrl, {
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
				timeout: 30_000,
			});

			const status = res.data?.log?.status;

			if (i === 0 || status !== lastStatus) {
				console.debug("[SearchLeadsLeadDb] status", {
					logId,
					attempt: i + 1,
					statusUrl,
					status,
				});
			}

			lastStatus = status;

			if (status === "completed") {
				console.info("[SearchLeadsLeadDb] export completed", {
					logId,
					attempts: i + 1,
				});
				return;
			}

			if (status === "failed") {
				throw new Error(`SearchLeads export failed: ${logId}`);
			}

			// treat unknown / pending as pending
			await new Promise((r) => setTimeout(r, opts.intervalMs));
		}

		throw new Error(`SearchLeads export timed out: ${logId}`);
	}

	private async getExportResultRows(
		logId: string
	): Promise<SearchLeadsLeadRow[]> {
		const url = `${this.baseUrl}/api/logs/${logId}?outputFileFormat=json`;

		const res = await axios.get<SearchLeadsResultResponse>(url, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			timeout: 120_000,
		});

		const log = res.data?.log;
		if (!log)
			throw new Error("SearchLeads: missing log in export result response");

		if (log.status !== "completed") {
			// sometimes eventual consistency – better to fail loudly; orchestrator can retry later if you add that.
			throw new Error(
				`SearchLeads: export not completed yet (status=${log.status})`
			);
		}

		const data = log.data;

		if (!Array.isArray(data)) {
			// If someone accidentally passed outputFileFormat=csv/xlsx/pdf → data будет url string
			throw new Error(
				"SearchLeads: expected JSON array in log.data (outputFileFormat=json)"
			);
		}

		console.info("[SearchLeadsLeadDb] got result rows", {
			logId,
			rows: data.length,
		});
		return data as SearchLeadsLeadRow[];
	}

	private mapRowsToLeads(
		rows: SearchLeadsLeadRow[]
	): NormalizedLeadForCreate[] {
		return rows.map((row) => {
			const firstName = row.first_name ?? undefined;
			const lastName = row.last_name ?? undefined;

			const fullName =
				row.name ??
				[firstName, lastName].filter(Boolean).join(" ") ??
				undefined;

			// prefer work email; fallback to personal
			const email = row.email ?? row.personal_email ?? undefined;

			const location = this.buildLocation(row);

			return {
				source: LeadSource.SEARCH_LEADS,

				externalId: row.id ?? undefined,

				fullName,
				firstName,
				lastName,

				title: row.title ?? undefined,
				company: row.organization_name ?? undefined,
				companyDomain: row.organization_primary_domain ?? undefined,
				companyUrl: row.website_url ?? undefined,
				linkedinUrl: row.linkedin_url ?? undefined,
				location,

				email,
				raw: row,
			};
		});
	}

	private buildLocation(row: SearchLeadsLeadRow): string | undefined {
		const parts = [row.city, row.state, row.country]
			.map((x) => (typeof x === "string" ? x.trim() : ""))
			.filter(Boolean);

		return parts.length ? parts.join(", ") : undefined;
	}

	private normalizeNoOfLeads(limit: number): number {
		const n = Number.isFinite(limit) ? Math.floor(limit) : 100;
		return Math.max(1, n);
	}

	private normalizeFileName(fileName?: string): string | undefined {
		const trimmed = (fileName ?? "").trim();
		if (!trimmed) return undefined;

		return trimmed.slice(0, 80);
	}

	private logAndWrapAxiosError(e: unknown): void {
		if (!(e instanceof AxiosError)) {
			console.error("[SearchLeadsLeadDb] error", (e as Error).message);
			return;
		}

		console.error("[SearchLeadsLeadDb] error response", {
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
		const message = this.extractProviderMessage(e.response?.data);

		if (status === 401) {
			throw new UserFacingError({
				code: "SEARCHLEADS_UNAUTHORIZED",
				userMessage: "SearchLeads: invalid API key (Unauthorized).",
				debugMessage: message,
				details: { status },
			});
		}

		if (status === 400 || status === 422) {
			throw new UserFacingError({
				code: "SEARCHLEADS_INVALID_INPUT",
				userMessage:
					"SearchLeads rejected filters (invalid request). Please adjust the JSON and try again.",
				debugMessage: message,
				details: { status, providerMessage: message },
			});
		}
	}

	private extractProviderMessage(data: unknown): string | undefined {
		const d = data as { message?: unknown; details?: unknown } | undefined;
		if (!d) return undefined;

		const m = typeof d.message === "string" ? d.message : undefined;
		if (m) return m;

		try {
			return JSON.stringify(d);
		} catch {
			return undefined;
		}
	}
}
