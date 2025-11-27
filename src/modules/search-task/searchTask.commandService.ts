import { inject, injectable } from "inversify";
import { SearchTaskStatus } from "@prisma/client";

import { SEARCH_TASK_TYPES } from "./searchTask.types";
import { SearchTaskRepository } from "./searchTask.repository";
import { CreateSearchTaskBody } from "./searchTask.schemas";

@injectable()
export class SearchTaskCommandService {
	constructor(
		@inject(SEARCH_TASK_TYPES.SearchTaskRepository)
		private readonly searchTaskRepository: SearchTaskRepository
	) {}

	async createTask(input: CreateSearchTaskBody) {
		return this.searchTaskRepository.createTask({
			prompt: input.prompt,
			chatId: input.chatId,
			limit: input.limit,
			industry: input.industry,
			titles: input.titles,
			locations: input.locations,
			companySize: input.companySize,
		});
	}

	async markRunning(id: string, runId: string, fileName: string) {
		return this.searchTaskRepository.update(id, {
			status: SearchTaskStatus.RUNNING,
			runId,
			fileName,
			lastCheckedAt: new Date(),
		});
	}

	async markDone(id: string, totalLeads: number) {
		return this.searchTaskRepository.update(id, {
			status:
				totalLeads > 0
					? SearchTaskStatus.DONE
					: SearchTaskStatus.DONE_NO_RESULTS,
			totalLeads,
			lastCheckedAt: new Date(),
		});
	}

	async markFailed(id: string, error: unknown) {
		return this.searchTaskRepository.update(id, {
			status: SearchTaskStatus.FAILED,
			errorMessage: error instanceof Error ? error.message : String(error),
			lastCheckedAt: new Date(),
		});
	}
}
