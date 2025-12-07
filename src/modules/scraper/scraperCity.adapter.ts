import axios, { AxiosError } from "axios";
import { injectable } from "inversify";
import { ScraperProvider, LeadSource } from "@prisma/client";

import { loadEnv } from "../../config/env";
import {
	NormalizedLeadForCreate,
	ScrapeQuery,
	ScraperAdapter,
	ScraperAdapterResult,
	ScraperCityApolloRow,
} from "./scraper.dto";

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
		try {
			const startRes = await axios.post<{ runId: string }>(
				`${env.SCRAPERCITY_API_URL}/scrape/apollo`,
				{
					url: query.apolloUrl,
					count: query.limit,
				},
				{
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
					},
					timeout: 60_000,
				}
			);

			console.log("startRes", startRes.data);

			const runId = startRes.data.runId;

			let status = "running";

			for (let i = 0; i < 60; i++) {
				const statusRes = await axios.get<{ status: string }>(
					`${env.SCRAPERCITY_API_URL}/scrape/${runId}/status`,
					{
						headers: { Authorization: `Bearer ${this.apiKey}` },
						timeout: 30_000,
					}
				);

				console.log("statusRes", statusRes.data);

				status = statusRes.data.status;
				if (status === "succeeded") break;
				if (status === "failed") {
					throw new Error(`ScraperCity run failed: ${runId}`);
				}

				await new Promise((r) => setTimeout(r, 5_000));
			}

			if (status !== "succeeded") {
				throw new Error(`ScraperCity run timed out: ${runId}`);
			}

			const downloadRes = await axios.get<ScraperCityApolloRow[]>(
				`${env.SCRAPERCITY_API_URL}/scrape/${runId}/download?format=json`,
				{
					headers: { Authorization: `Bearer ${this.apiKey}` },
					timeout: 120_000,
				}
			);

			console.log("downloadRes", downloadRes.data);

			const rows = downloadRes.data;

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

			if(e instanceof AxiosError) {
				console.error("error", e.response?.data);
			} else {
				console.error("error", (e as Error).message);
			}
			throw e;
		}
	}
}
