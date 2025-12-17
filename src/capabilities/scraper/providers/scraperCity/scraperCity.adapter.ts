import axios, { AxiosError } from "axios";
import { injectable } from "inversify";
import { ScraperProvider, LeadSource } from "@prisma/client";

import { loadEnv } from "@/config/env";
import {
	NormalizedLeadForCreate,
	ScrapeQuery,
	ScraperAdapter,
	ScraperAdapterResult,
} from "@/capabilities/scraper/scraper.dto";
import { ScraperCityApolloRow } from "./scraperCity.dto";

const env = loadEnv();

@injectable()
export class ScraperCityApolloAdapter implements ScraperAdapter {
	public readonly provider = ScraperProvider.SCRAPER_CITY;

	constructor(
		private readonly apiKey: string,
		private readonly enabled: boolean
	) {}

	isEnabled(): boolean {
		return this.enabled && !!this.apiKey;
	}

	async scrape(query: ScrapeQuery): Promise<ScraperAdapterResult> {
		if (!this.isEnabled()) {
			throw new Error("ScraperCityApolloAdapter is disabled or misconfigured");
		}
		if (!env.SCRAPERCITY_API_URL) {
			throw new Error("SCRAPERCITY_API_URL is not set");
		}

		try {
			const startRes = await axios.post<{ runId: string }>(
				`${env.SCRAPERCITY_API_URL}/v1/scrape/apollo`,
				{
					url: query.apolloUrl,
					count: query.limit,
				},
				{
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					timeout: 5 * 60 * 1000, // 5 min
				}
			);

			const runId = startRes.data.runId;
			console.info("[ScraperCityApollo] run started", { runId });

			let status: string | undefined;
			let lastStatus: string | undefined;

			for (let i = 0; i < 60; i++) {
				const statusRes = await axios.get<{ status: string }>(
					`${env.SCRAPERCITY_API_URL}/v1/scrape/status/${runId}`,
					{
						headers: { Authorization: `Bearer ${this.apiKey}` },
						timeout: 30_000,
					}
				);

				status = String(statusRes.data.status ?? "").toUpperCase();
				if (i === 0 || status !== lastStatus) {
					console.info("[ScraperCityApollo] run status", {
						runId,
						status,
						attempt: i + 1,
					});
				}
				lastStatus = status;

				if (status === "SUCCEEDED" || status === "SUCCESS") break;
				if (status === "FAILED") {
					throw new Error(`ScraperCity run failed: ${runId}`);
				}

				await new Promise((r) => setTimeout(r, 5_000));
			}

			if (status !== "SUCCEEDED" && status !== "SUCCESS") {
				throw new Error(`ScraperCity run timed out: ${runId}`);
			}

			const downloadRes = await axios.get<ScraperCityApolloRow[]>(
				`${env.SCRAPERCITY_API_URL}/downloads/${runId}?format=json`,
				{
					headers: { Authorization: `Bearer ${this.apiKey}` },
					timeout: 120_000,
				}
			);

			const rows = downloadRes.data;
			console.info("[ScraperCityApollo] download complete", {
				runId,
				rows: Array.isArray(rows) ? rows.length : 0,
			});

			const leads: NormalizedLeadForCreate[] = rows.map((row) => ({
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

			return {
				provider: this.provider,
				providerRunId: runId,
				fileNameHint: `scrapercity-${runId}.json`,
				leads,
			};
		} catch (e) {
			if (e instanceof AxiosError) {
				console.error("[ScraperCityApollo] error response", {
					status: e.response?.status,
					data: e.response?.data as unknown,
					request: {
						method: e.config?.method,
						url: e.config?.url,
					},
				});
			} else {
				console.error("[ScraperCityApollo] error", (e as Error).message);
			}
			throw e;
		}
	}
}
