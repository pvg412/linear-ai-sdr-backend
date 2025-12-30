import type { Container } from "inversify";
import { LEAD_SEARCH_TYPES } from "./lead-search.types";
import { LeadSearchRunnerService } from "./lead-search.runner.service";
import { LeadSearchRunRepository } from "./persistence/lead-search-run.repository";
import { LeadSearchRepository } from "./persistence/lead-search.repository";
import { LeadDbLeadSearchHandler } from "./services/lead-db.lead-search.handler";
import { LeadSearchLeadPersisterService } from "./services/lead-search.lead-persister.service";
import { LeadSearchNotifierService } from "./services/lead-search.notifier.service";
import { ScraperInlineLeadSearchHandler } from "./services/scraper-inline.lead-search.handler";
import { ScraperStepLeadSearchHandler } from "./services/scraper-step.lead-search.handler";

export function registerLeadSearchModule(container: Container) {
	container
		.bind<LeadSearchRunnerService>(LEAD_SEARCH_TYPES.LeadSearchRunnerService)
		.to(LeadSearchRunnerService)
		.inSingletonScope();

	container
		.bind<LeadSearchRunRepository>(LEAD_SEARCH_TYPES.LeadSearchRunRepository)
		.to(LeadSearchRunRepository)
		.inSingletonScope();

	container
		.bind<LeadSearchNotifierService>(
			LEAD_SEARCH_TYPES.LeadSearchNotifierService
		)
		.to(LeadSearchNotifierService)
		.inSingletonScope();

	container
		.bind<LeadSearchLeadPersisterService>(
			LEAD_SEARCH_TYPES.LeadSearchLeadPersisterService
		)
		.to(LeadSearchLeadPersisterService)
		.inSingletonScope();

	container
		.bind<LeadDbLeadSearchHandler>(LEAD_SEARCH_TYPES.LeadDbLeadSearchHandler)
		.to(LeadDbLeadSearchHandler)
		.inSingletonScope();

	container
		.bind<ScraperInlineLeadSearchHandler>(
			LEAD_SEARCH_TYPES.ScraperInlineLeadSearchHandler
		)
		.to(ScraperInlineLeadSearchHandler)
		.inSingletonScope();

	container
		.bind<ScraperStepLeadSearchHandler>(
			LEAD_SEARCH_TYPES.ScraperStepLeadSearchHandler
		)
		.to(ScraperStepLeadSearchHandler)
		.inSingletonScope();

	container
		.bind<LeadSearchRepository>(LEAD_SEARCH_TYPES.LeadSearchRepository)
		.to(LeadSearchRepository)
		.inSingletonScope();
}
