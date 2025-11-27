import { inject, injectable } from "inversify";

import { SEARCH_TASK_TYPES } from "./searchTask.types";
import { SearchTaskRepository } from "./searchTask.repository";

@injectable()
export class SearchTaskQueryService {
	constructor(
		@inject(SEARCH_TASK_TYPES.SearchTaskRepository)
		private readonly searchTaskRepository: SearchTaskRepository
	) {}

	async getById(id: string) {
		return this.searchTaskRepository.findById(id);
	}

	async getActive(limit = 50) {
		return this.searchTaskRepository.findActive(limit);
	}
}
