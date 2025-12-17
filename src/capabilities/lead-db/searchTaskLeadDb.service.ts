import { inject, injectable } from "inversify";
import { ScraperProvider, type Prisma } from "@prisma/client";

import { SEARCH_TASK_TYPES } from "@/modules/search-task/search-task.types";
import { SearchTaskQueryService } from "@/modules/search-task/search-task.queryService";
import { SearchTaskCommandService } from "@/modules/search-task/search-task.commandService";
import { SearchTaskRepository } from "@/modules/search-task/search-task.repository";

import { LEAD_TYPES } from "@/modules/lead/lead.types";
import { LeadCommandService } from "@/modules/lead/lead.commandService";

import { LEAD_DB_TYPES } from "./lead-db.types";
import { LeadDbOrchestrator } from "./lead-db.orchestrator";
import { mergeAndTrimLeadDbResults } from "./lead-db.merger";
import type { LeadDbCanonicalFilters } from "./lead-db.dto";
import { msSince, nowNs, type LoggerLike } from "@/infra/observability";
import { NotFoundError } from "@/infra/errors";

@injectable()
export class SearchTaskLeadDbService {
  // ScraperCity constraints (count: 500-50_000, default 1000)
  // Keep this in the service so DB reflects actual provider request.
  private static normalizeScraperCityCount(limit: number): number {
    const min = 500;
    const max = 50_000;
    const n = Number.isFinite(limit) ? Math.floor(limit) : min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  constructor(
    @inject(SEARCH_TASK_TYPES.SearchTaskQueryService)
    private readonly queryService: SearchTaskQueryService,

    @inject(SEARCH_TASK_TYPES.SearchTaskCommandService)
    private readonly commandService: SearchTaskCommandService,

    @inject(SEARCH_TASK_TYPES.SearchTaskRepository)
    private readonly searchTaskRepository: SearchTaskRepository,

    @inject(LEAD_TYPES.LeadCommandService)
    private readonly leadCommandService: LeadCommandService,

    @inject(LEAD_DB_TYPES.LeadDbOrchestrator)
    private readonly leadDbOrchestrator: LeadDbOrchestrator,
  ) {}

  async run(id: string, log?: LoggerLike): Promise<void> {
    const t0 = nowNs();
    log?.info({ searchTaskId: id }, "Lead DB run started");
    const task = await this.queryService.getById(id);
    if (!task) throw new NotFoundError("SearchTask not found");

    // Align stored task.limit with provider reality (ScraperCity has min count).
    const effectiveLimit = SearchTaskLeadDbService.normalizeScraperCityCount(
      task.limit,
    );
    if (effectiveLimit !== task.limit) {
      log?.info(
        { searchTaskId: task.id, requestedLimit: task.limit, effectiveLimit },
        "Lead DB normalized limit to provider constraints",
      );
      await this.searchTaskRepository.update(task.id, { limit: effectiveLimit });
    }

    await this.commandService.markRunning(id, "PENDING", "PENDING");

    const fallbackFilters: LeadDbCanonicalFilters = {
      personTitles: task.titles ?? [],
      companyIndustry: task.industry ?? undefined,
      companySize: task.companySize ?? undefined,
      personCountry: task.locations?.[0] ?? undefined,
    };

    const leadDbFilters =
      (task.leadDbFilters as Prisma.JsonObject | null) ?? null;

    const apolloFilters: LeadDbCanonicalFilters =
      (leadDbFilters as unknown as LeadDbCanonicalFilters) ?? fallbackFilters;

    try {
      log?.info(
        {
          searchTaskId: task.id,
          limit: effectiveLimit,
          titlesCount: apolloFilters.personTitles?.length ?? 0,
          hasIndustry: Boolean(apolloFilters.companyIndustry),
          hasCompanySize: Boolean(apolloFilters.companySize),
          hasCountry: Boolean(apolloFilters.personCountry),
        },
        "Lead DB scraping started",
      );

      const { providerResults, errors } = await this.leadDbOrchestrator.scrapeParallel(
        task.id,
        {
          limit: effectiveLimit,
          filters: apolloFilters,
          fileName: `search_${task.id}`,
        },
        {
          providersOrder: [
            // ScraperProvider.SEARCH_LEADS,
            ScraperProvider.SCRAPER_CITY,
          ],
        },
        log?.child ? log.child({ component: "LeadDbOrchestrator" }) : log,
      );

      const leads = mergeAndTrimLeadDbResults(providerResults, effectiveLimit);

      log?.info(
        {
          searchTaskId: task.id,
          durationMs: msSince(t0),
          providers: providerResults.map((r) => r.provider),
          providersLeads: providerResults.map((r) => ({
            provider: r.provider,
            leads: r.leads.length,
            providerRunId: r.providerRunId ?? undefined,
            fileNameHint: r.fileNameHint ?? undefined,
          })),
          providerErrors: Object.keys(errors).length ? errors : undefined,
          mergedLeads: leads.length,
        },
        "Lead DB scraping completed (raw results merged)",
      );

      await this.searchTaskRepository.update(task.id, {
        scraperProvider: providerResults[0]?.provider ?? undefined,
      });

      const { count } = await this.leadCommandService.bulkCreateForSearchTask({
        searchTaskId: task.id,
        leads,
      });

      const runId =
        providerResults
          .map((r) => `${r.provider}:${r.providerRunId ?? "n/a"}`)
          .join("|") || "N/A";

      const fileName =
        providerResults
          .map((r) => r.fileNameHint ?? "")
          .filter(Boolean)
          .join("|") || "N/A";

      await this.commandService.markRunning(task.id, runId, fileName);
      await this.commandService.markDone(task.id, count);
      log?.info(
        { searchTaskId: task.id, leadsInserted: count, durationMs: msSince(t0) },
        "Lead DB run finished successfully",
      );
    } catch (error) {
      log?.error(
        { err: error, searchTaskId: task.id, durationMs: msSince(t0) },
        "Lead DB run failed",
      );
      await this.commandService.markFailed(task.id, error);
      throw error;
    }
  }
}
