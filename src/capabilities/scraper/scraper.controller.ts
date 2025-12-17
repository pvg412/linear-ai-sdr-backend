import { FastifyInstance } from "fastify";

import { container } from "@/container";
import { SearchTaskScraperService } from "./searchTaskScraper.service";
import { SCRAPER_TYPES } from "./scraper.types";
import { getSearchTaskParamsSchema } from "@/modules/search-task/search-task.schemas";
import { SearchTaskQueryService } from "@/modules/search-task/search-task.queryService";
import { SEARCH_TASK_TYPES } from "@/modules/search-task/search-task.types";

export function registerScraperRoutes(app: FastifyInstance) {
	const scraperService = container.get<SearchTaskScraperService>(
		SCRAPER_TYPES.SearchTaskScraperService
	);
	const searchTaskQueryService = container.get<SearchTaskQueryService>(
		SEARCH_TASK_TYPES.SearchTaskQueryService
	);

	app.post("/scraper/:id/run", async (request, reply) => {
		const params = getSearchTaskParamsSchema.parse(request.params);

		const task = await searchTaskQueryService.getById(params.id);
		if (!task) {
			return reply.code(404).send({ message: "SearchTask not found" });
		}

		const log = request.log.child({ searchTaskId: params.id });
		void scraperService.run(params.id, log).catch((error: unknown) => {
			log.error({ err: error }, "Scraper run failed");
		});

		return reply.code(202).send({ message: "Scraper run started" });
	});
}
