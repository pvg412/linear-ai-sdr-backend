import { FastifyInstance } from "fastify";

import { container } from "../../container";
import { SEARCH_TASK_TYPES } from "./search-task.types";
import {
	createSearchTaskBodySchema,
	getSearchTaskParamsSchema,
	markDoneBodySchema,
	markFailedBodySchema,
	markRunningBodySchema,
} from "./search-task.schemas";
import { SearchTaskCommandService } from "./search-task.commandService";
import { SearchTaskQueryService } from "./search-task.queryService";

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

	app.patch("/search-tasks/:id/running", async (request, _reply) => {
		const params = getSearchTaskParamsSchema.parse(request.params);
		const body = markRunningBodySchema.parse(request.body);
		const task = await commandService.markRunning(
			params.id,
			body.runId,
			body.fileName
		);
		return task;
	});

	app.patch("/search-tasks/:id/done", async (request, _reply) => {
		const params = getSearchTaskParamsSchema.parse(request.params);
		const body = markDoneBodySchema.parse(request.body);
		const task = await commandService.markDone(params.id, body.totalLeads);
		return task;
	});

	app.patch("/search-tasks/:id/failed", async (request, _reply) => {
		const params = getSearchTaskParamsSchema.parse(request.params);
		const body = markFailedBodySchema.parse(request.body);
		const task = await commandService.markFailed(params.id, body.error);
		return task;
	});

	app.get("/search-tasks", async (_request, _reply) => {
		const tasks = await queryService.getActive();
		return tasks;
	});
}
