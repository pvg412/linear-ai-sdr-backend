import { FastifyInstance } from "fastify";

import { container } from "../../container";
import { SearchTaskScraperService } from "./searchTaskScraper.service";
import { SCRAPER_TYPES } from "./scraper.types";
import { getSearchTaskParamsSchema } from "../search-task/search-task.schemas";

export function registerScraperRoutes(app: FastifyInstance) {
	const scraperService = container.get<SearchTaskScraperService>(
		SCRAPER_TYPES.SearchTaskScraperService
	);

	app.post("/scraper/:id/run", async (request, _) => {
		const params = getSearchTaskParamsSchema.parse(request.params);

		await scraperService.run(params.id);

		return { message: "Scraper run started successfully" };
	});
}
