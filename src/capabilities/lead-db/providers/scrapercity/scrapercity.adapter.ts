import { injectable } from "inversify";
import { ScraperProvider } from "@prisma/client";

import type { LeadDbAdapter, LeadDbAdapterResult, LeadDbQuery } from "@/capabilities/lead-db/lead-db.dto";
import { buildScraperCityPayload } from "./scrapercity.filterMapper";
import { ScraperCityClient } from "./scrapercity.client";
import { mapScraperCityRowsToLeads } from "./scrapercity.leadMapper";
import { validateNormalizedLeads } from "@/capabilities/lead-db/shared/leadValidate";
import { wrapScraperCityAxiosError } from "./scrapercity.errors";

@injectable()
export class ScraperCityLeadDbAdapter implements LeadDbAdapter {
  public readonly provider = ScraperProvider.SCRAPER_CITY;

  private readonly client: ScraperCityClient;

  constructor(
    private readonly apiKey: string,
    private readonly enabled: boolean,
  ) {
    this.client = new ScraperCityClient(apiKey);
  }

  isEnabled(): boolean {
    return this.enabled && !!this.apiKey;
  }

  async scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult> {
    const { payload, fileName } = buildScraperCityPayload(query);

    try {
      console.info("[ScraperCityLeadDb] start payload", { payload });

      const runId = await this.client.startApolloFilters(payload);
      const status = await this.client.waitForSucceeded(runId, { intervalMs: 5_000, maxAttempts: 180 });

      const rows = await this.client.downloadJsonRows(runId, status);
      const leadsRaw = mapScraperCityRowsToLeads(rows);

      const leads = validateNormalizedLeads(leadsRaw, {
        mode: "drop",
        provider: ScraperProvider.SCRAPER_CITY,
        minValid: 0, // allow empty result
      });

      return {
        provider: this.provider,
        providerRunId: runId,
        fileNameHint: fileName ? `${fileName}.json` : `scrapercity-${runId}.json`,
        leads,
      };
    } catch (e) {
      wrapScraperCityAxiosError(e);
      throw e;
    }
  }
}
