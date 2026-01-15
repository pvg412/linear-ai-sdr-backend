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
import type { SearchLeadsLimiter } from "./searchleads.limiter";
import { splitSearchLeadsBulkFilter } from "./searchleads.bulk";
import { getLeadSearchAsyncContext } from "@/infra/async-context/leadSearchAsyncContext";

@injectable()
export class SearchLeadsLeadDbAdapter implements LeadDbAdapter {
  public readonly provider = LeadProvider.SEARCH_LEADS;

  private readonly client: SearchLeadsClient;

  constructor(
    private readonly apiKey: string,
    private readonly enabled: boolean,
    private readonly limiter?: SearchLeadsLimiter,
  ) {
    this.client = new SearchLeadsClient(apiKey, limiter);
  }

  isEnabled(): boolean {
    return this.enabled && !!this.apiKey;
  }

  async scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult> {
    const { payload, fileName } = buildSearchLeadsCreateExportRequest(query);

    try {
      console.info("[SearchLeadsLeadDb] create export payload", { fileName, payload });

      const { filters, bulkKey } = splitSearchLeadsBulkFilter(payload.filter);
      if (bulkKey && filters.length > 1) {
        console.info("[SearchLeadsLeadDb] bulk filter split", {
          fileName,
          bulkKey,
          chunks: filters.length,
        });
      }

      const ctx = getLeadSearchAsyncContext();
      const resumeIds = Array.isArray(ctx?.resumeProviderRunIds)
        ? ctx?.resumeProviderRunIds.filter((v): v is string => typeof v === "string" && v.length > 0)
        : [];

      const runChunk = async (args: {
        filterOverride: typeof payload.filter;
        resumeLogId?: string;
      }) => {
        const logId =
          typeof args.resumeLogId === "string" && args.resumeLogId.length > 0
            ? args.resumeLogId
            : await this.client.createExport({ ...payload, filter: args.filterOverride });

        // Persist as early as possible (survives restarts; idempotent in repository).
        await ctx?.onProviderRunId?.({ providerRunId: logId });

        await this.client.waitForCompleted(logId, { intervalMs: 5_000, maxAttempts: 240 });
        const rows = await this.client.getCompletedRows(logId);
        return { logId, rows };
      };

      const chunks = await (this.limiter
        ? this.limiter.withTaskSlot(async () => {
            const out: Awaited<ReturnType<typeof runChunk>>[] = [];
            for (let i = 0; i < filters.length; i += 1) {
              const f = filters[i];
              out.push(
                await runChunk({
                  filterOverride: f,
                  resumeLogId: resumeIds[i],
                }),
              );
            }
            return out;
          })
        : (async () => {
            const out: Awaited<ReturnType<typeof runChunk>>[] = [];
            for (let i = 0; i < filters.length; i += 1) {
              const f = filters[i];
              out.push(
                await runChunk({
                  filterOverride: f,
                  resumeLogId: resumeIds[i],
                }),
              );
            }
            return out;
          })());

      const allRows = chunks.flatMap((c) => c.rows);
      const providerRunId = chunks[0]?.logId ?? null;

      const leadsRaw = mapSearchLeadsRowsToLeads(allRows);

      const leads = validateNormalizedLeads(leadsRaw, {
        mode: "drop",
        provider: LeadProvider.SEARCH_LEADS,
        minValid: 0, // allow empty result
      });

      return {
        provider: this.provider,
        providerRunId,
        fileNameHint: `${fileName}.json`,
        leads,
      };
    } catch (e) {
      wrapSearchLeadsAxiosError(e);
      throw e;
    }
  }
}
