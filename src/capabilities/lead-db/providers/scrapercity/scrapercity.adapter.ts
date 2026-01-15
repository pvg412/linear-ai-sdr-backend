import { injectable } from "inversify";
import { LeadProvider } from "@prisma/client";

import type {
	LeadDbAdapter,
	LeadDbAdapterResult,
	LeadDbQuery,
} from "@/capabilities/lead-db/lead-db.dto";
import { buildScraperCityPayload } from "./scrapercity.filterMapper";
import { ScraperCityClient } from "./scrapercity.client";
import { mapScraperCityRowsToLeads } from "./scrapercity.leadMapper";
import { validateNormalizedLeads } from "@/capabilities/shared/leadValidate";
import { wrapScraperCityAxiosError } from "./scrapercity.errors";
import type { ScraperCityLimiter } from "./scrapercity.limiter";

@injectable()
export class ScraperCityLeadDbAdapter implements LeadDbAdapter {
	public readonly provider = LeadProvider.SCRAPER_CITY;

	private readonly client: ScraperCityClient;

	constructor(
		private readonly apiKey: string,
		private readonly enabled: boolean,
		private readonly limiter?: ScraperCityLimiter
	) {
		this.client = new ScraperCityClient(apiKey, limiter);
	}

	isEnabled(): boolean {
		return this.enabled && !!this.apiKey;
	}

	async scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult> {
		const { payload, fileName } = buildScraperCityPayload(query);

		try {
			const run = async () => {
				console.info("[ScraperCityLeadDb] start payload", { payload });

				const runId = await this.client.startApolloFilters(payload);
				const status = await this.client.waitForSucceeded(runId, {
					intervalMs: 5_000,
					maxAttempts: 180,
				});

				const rows = await this.client.downloadJsonRows(runId, status);

				console.info("[ScraperCityLeadDb] rows", { rows });

				const leadsRaw = mapScraperCityRowsToLeads(rows);

				const leads = validateNormalizedLeads(leadsRaw, {
					mode: "drop",
					provider: LeadProvider.SCRAPER_CITY,
					minValid: 0, // allow empty result
				});

				return {
					provider: this.provider,
					providerRunId: runId,
					fileNameHint: fileName
						? `${fileName}.json`
						: `scrapercity-${runId}.json`,
					leads,
				};
			};

			return this.limiter ? await this.limiter.withTaskSlot(run) : await run();
		} catch (e) {
			wrapScraperCityAxiosError(e);
			throw e;
		}
	}
}
