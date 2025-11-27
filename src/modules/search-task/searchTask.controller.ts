import { FastifyInstance } from "fastify";

import { container } from "../../container";
import { SEARCH_TASK_TYPES } from "./searchTask.types";
import {
	createSearchTaskBodySchema,
	getSearchTaskParamsSchema,
} from "./searchTask.schemas";
import { SearchTaskCommandService } from "./searchTask.commandService";
import { SearchTaskQueryService } from "./searchTask.queryService";

export function registerSearchTaskRoutes(app: FastifyInstance) {
	const commandService = container.get<SearchTaskCommandService>(
		SEARCH_TASK_TYPES.SearchTaskCommandService
	);
	const queryService = container.get<SearchTaskQueryService>(
		SEARCH_TASK_TYPES.SearchTaskQueryService
	);

	app.post("/search-tasks", async (request, reply) => {
		const body = createSearchTaskBodySchema.parse(request.body);
		const task = await commandService.createTask(body);
		reply.code(201).send(task);
	});

	app.get("/search-tasks/:id", async (request, reply) => {
		const params = getSearchTaskParamsSchema.parse(request.params);
		const task = await queryService.getById(params.id);

		if (!task) {
			return reply.code(404).send({ message: "Search task not found" });
		}

		return task;
	});

	app.get("/search-tasks", async (_request, _reply) => {
		const tasks = await queryService.getActive();
		return tasks;
	});
}
