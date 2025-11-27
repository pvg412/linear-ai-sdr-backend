import "reflect-metadata";
import { Container } from "inversify";

import { SearchTaskRepository } from "./modules/search-task/searchTask.repository";
import { SearchTaskCommandService } from "./modules/search-task/searchTask.commandService";
import { SearchTaskQueryService } from "./modules/search-task/searchTask.queryService";
import { SEARCH_TASK_TYPES } from "./modules/search-task/searchTask.types";
import { LEAD_TYPES } from "./modules/lead/lead.types";
import { LeadRepository } from "./modules/lead/lead.repository";
import { LeadCommandService } from "./modules/lead/lead.commandService";
import { LeadQueryService } from "./modules/lead/lead.queryService";

const container = new Container();

container
	.bind<SearchTaskRepository>(SEARCH_TASK_TYPES.SearchTaskRepository)
	.to(SearchTaskRepository)
	.inSingletonScope();

container
	.bind<SearchTaskCommandService>(SEARCH_TASK_TYPES.SearchTaskCommandService)
	.to(SearchTaskCommandService)
	.inSingletonScope();

container
	.bind<SearchTaskQueryService>(SEARCH_TASK_TYPES.SearchTaskQueryService)
	.to(SearchTaskQueryService)
	.inSingletonScope();

container
	.bind<LeadRepository>(LEAD_TYPES.LeadRepository)
	.to(LeadRepository)
	.inSingletonScope();

container
	.bind<LeadCommandService>(LEAD_TYPES.LeadCommandService)
	.to(LeadCommandService)
	.inSingletonScope();

container
	.bind<LeadQueryService>(LEAD_TYPES.LeadQueryService)
	.to(LeadQueryService)
	.inSingletonScope();

export { container };
