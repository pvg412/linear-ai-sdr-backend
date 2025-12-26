import { injectable } from "inversify";
import { LeadProvider } from "@prisma/client";

import type {
	ScrapeQuery,
	ScraperAdapter,
	ScraperAdapterResult,
} from "@/capabilities/scraper/scraper.dto";
import { validateNormalizedLeads } from "@/capabilities/shared/leadValidate";

import { ScraperCityClient } from "./scrapercity.client";
import { mapScraperCityRowsToLeads } from "./scrapercity.leadMapper";
import { wrapScraperCityAxiosError } from "./scrapercity.errors";

const SCRAPER_CITY_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

@injectable()
export class ScraperCityScraperAdapter implements ScraperAdapter {
	public readonly provider = LeadProvider.SCRAPER_CITY;
	private readonly client: ScraperCityClient;

	constructor(
		private readonly apiKey: string,
		private readonly enabled: boolean
	) {
		this.client = new ScraperCityClient(apiKey);
	}

	isEnabled(): boolean {
		return this.enabled && !!this.apiKey;
	}

	async scrape(query: ScrapeQuery): Promise<ScraperAdapterResult> {
		try {
			const count = normalizeCount(query.limit);

			const runId = await this.client.startApolloUrl({
				url: query.apolloUrl,
				count,
			});

			const status = await this.client.waitForSucceeded(runId, {
				intervalMs: SCRAPER_CITY_POLL_INTERVAL_MS,
				maxAttempts: 180,
			});

			const rows = await this.client.downloadJsonRows(runId, status);
			const leadsRaw = mapScraperCityRowsToLeads(rows);

			const leadsValidated = validateNormalizedLeads(leadsRaw, {
				mode: "drop",
				provider: LeadProvider.SCRAPER_CITY,
				minValid: 0,
			});

			// Important: if count was increased to min (500), return strictly query.limit
			const leads = leadsValidated.slice(0, query.limit);

			return {
				provider: this.provider,
				providerRunId: runId,
				fileNameHint: `scrapercity-${runId}.json`,
				leads,
			};
		} catch (e) {
			wrapScraperCityAxiosError(e);
			throw e;
		}
	}
}

function normalizeCount(limit: number): number {
	// keep compatible with lead-db (ScraperCity often doesn't like small values)
	const min = 500;
	const max = 50_000;
	const n = Number.isFinite(limit) ? Math.floor(limit) : min;
	if (n < min) return min;
	if (n > max) return max;
	return n;
}
