import { injectable } from "inversify";
import { LeadProvider } from "@prisma/client";

import type {
  LeadDbAdapter,
  LeadDbAdapterResult,
  LeadDbQuery,
} from "@/capabilities/lead-db/lead-db.dto";
import { buildSearchLeadsCreateExportRequest } from "./searchleads.filterMapper";
import { SearchLeadsClient } from "./searchleads.client";
import { mapSearchLeadsRowsToLeads } from "./searchleads.leadMapper";
import { validateNormalizedLeads } from "@/capabilities/shared/leadValidate";
import { wrapSearchLeadsAxiosError } from "./searchleads.errors";

@injectable()
export class SearchLeadsLeadDbAdapter implements LeadDbAdapter {
  public readonly provider = LeadProvider.SEARCH_LEADS;

  private readonly client: SearchLeadsClient;

  constructor(
    private readonly apiKey: string,
    private readonly enabled: boolean,
  ) {
    this.client = new SearchLeadsClient(apiKey);
  }

  isEnabled(): boolean {
    return this.enabled && !!this.apiKey;
  }

  async scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult> {
    const { payload, fileName } = buildSearchLeadsCreateExportRequest(query);

    try {
      console.info("[SearchLeadsLeadDb] create export payload", { fileName, payload });

      const logId = await this.client.createExport(payload);
      await this.client.waitForCompleted(logId, { intervalMs: 5_000, maxAttempts: 240 });

      const rows = await this.client.getCompletedRows(logId);
      const leadsRaw = mapSearchLeadsRowsToLeads(rows);

      const leads = validateNormalizedLeads(leadsRaw, {
        mode: "drop",
        provider: LeadProvider.SEARCH_LEADS,
        minValid: 0, // allow empty result
      });

      return {
        provider: this.provider,
        providerRunId: logId,
        fileNameHint: `${fileName}.json`,
        leads,
      };
    } catch (e) {
      wrapSearchLeadsAxiosError(e);
      throw e;
    }
  }
}
