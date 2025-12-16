import { FastifyInstance } from "fastify";

import { container } from "@/container";
import { SearchTaskScraperService } from "./searchTaskScraper.service";
import { SCRAPER_TYPES } from "./scraper.types";
import { getSearchTaskParamsSchema } from "../search-task/search-task.schemas";
import { NotFoundError } from "@/infra/errors";

export function registerScraperRoutes(app: FastifyInstance) {
	const scraperService = container.get<SearchTaskScraperService>(
		SCRAPER_TYPES.SearchTaskScraperService
	);

	app.post("/scraper/:id/run", async (request, reply) => {
		const params = getSearchTaskParamsSchema.parse(request.params);

		try {
			await scraperService.run(params.id);
		} catch (error) {
			if (error instanceof NotFoundError) {
				return reply.code(404).send({ message: error.message });
			}
			throw error;
		}

		return { message: "Scraper run started successfully" };
	});
}
