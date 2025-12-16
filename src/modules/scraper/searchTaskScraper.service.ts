import { inject, injectable } from "inversify";
import { ScraperProvider } from "@prisma/client";

import { SEARCH_TASK_TYPES } from "../search-task/search-task.types";
import { SearchTaskQueryService } from "../search-task/search-task.queryService";
import { SearchTaskCommandService } from "../search-task/search-task.commandService";
import { LeadCommandService } from "../lead/lead.commandService";
import { LEAD_TYPES } from "../lead/lead.types";
import { SCRAPER_TYPES } from "./scraper.types";
import { ScraperOrchestrator } from "./scraper.orchestrator";
import { SearchTaskRepository } from "../search-task/search-task.repository";
import { buildApolloPeopleUrl } from "./apolloUrlBuilder";
import { msSince, nowNs, type LoggerLike } from "@/infra/observability";

@injectable()
export class SearchTaskScraperService {
	constructor(
		@inject(SEARCH_TASK_TYPES.SearchTaskQueryService)
		private readonly queryService: SearchTaskQueryService,

		@inject(SEARCH_TASK_TYPES.SearchTaskCommandService)
		private readonly commandService: SearchTaskCommandService,

		@inject(LEAD_TYPES.LeadCommandService)
		private readonly leadCommandService: LeadCommandService,

		@inject(SCRAPER_TYPES.ScraperOrchestrator)
		private readonly scraperOrchestrator: ScraperOrchestrator,

		@inject(SEARCH_TASK_TYPES.SearchTaskRepository)
		private readonly searchTaskRepository: SearchTaskRepository
	) {}

	async run(id: string, log?: LoggerLike): Promise<void> {
		const t0 = nowNs();
		log?.info({ searchTaskId: id }, "Scraping run started");
		const task = await this.queryService.getById(id);

		if (!task) {
			throw new Error("SearchTask not found");
		}

		const { apolloUrl: builtUrl } = buildApolloPeopleUrl({
			id: task.id,
			industry: task.industry ?? undefined,
			titles: task.titles ?? [],
			locations: task.locations ?? [],
			companySize: task.companySize ?? undefined,
			limit: task.limit ?? undefined,
		});

		const apolloUrl = task.apolloUrl ?? builtUrl;

		await this.commandService.markRunning(id, "PENDING", "PENDING");

		try {
			log?.info(
				{
					searchTaskId: task.id,
					limit: task.limit,
					providersOrder: [ScraperProvider.SCRUPP],
				},
				"Scraping orchestrator started"
			);

			const result = await this.scraperOrchestrator.scrapeWithFallback(
				task.id,
				{ apolloUrl, limit: task.limit },
				{
					providersOrder: [ScraperProvider.SCRUPP],
					minLeads: task.limit,
					allowUnderDeliveryFallback: true,
				}
			);

			await this.searchTaskRepository.update(task.id, {
				scraperProvider: result.provider,
			});

			const { count } = await this.leadCommandService.bulkCreateForSearchTask({
				searchTaskId: task.id,
				leads: result.leads,
			});

			await this.commandService.markRunning(
				task.id,
				result.providerRunId ?? "N/A",
				result.fileNameHint ?? "N/A"
			);

			await this.commandService.markDone(task.id, count);
			log?.info(
				{
					searchTaskId: task.id,
					leadsInserted: count,
					durationMs: msSince(t0),
				},
				"Scraping run finished successfully"
			);
		} catch (error) {
			log?.error(
				{ err: error, searchTaskId: task.id, durationMs: msSince(t0) },
				"Scraping run failed"
			);
			await this.commandService.markFailed(task.id, error);
			throw error;
		}
	}
}
