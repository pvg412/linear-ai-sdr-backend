import { inject, injectable } from "inversify";

import { SEARCH_TASK_TYPES } from "./search-task.types";
import { SearchTaskRepository } from "./search-task.repository";
import { GetSearchTaskResponse, ListSearchTasksResponse } from "./search-task.dto";

@injectable()
export class SearchTaskQueryService {
	constructor(
		@inject(SEARCH_TASK_TYPES.SearchTaskRepository)
		private readonly searchTaskRepository: SearchTaskRepository
	) {}

	async getById(id: string): Promise<GetSearchTaskResponse> {
		return this.searchTaskRepository.findById(id);
	}

	async getActive(limit = 50): Promise<ListSearchTasksResponse> {
		return this.searchTaskRepository.findActive(limit);
	}
}
