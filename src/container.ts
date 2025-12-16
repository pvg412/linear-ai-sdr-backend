import "reflect-metadata";
import { Container } from "inversify";

import { loadEnv } from "./config/env";
import { SearchTaskRepository } from "./modules/search-task/search-task.repository";
import { SearchTaskCommandService } from "./modules/search-task/search-task.commandService";
import { SearchTaskQueryService } from "./modules/search-task/search-task.queryService";
import { SEARCH_TASK_TYPES } from "./modules/search-task/search-task.types";
import { LEAD_TYPES } from "./modules/lead/lead.types";
import { LeadRepository } from "./modules/lead/lead.repository";
import { LeadCommandService } from "./modules/lead/lead.commandService";
import { LeadQueryService } from "./modules/lead/lead.queryService";
import { SearchTaskScraperService } from "./modules/scraper/searchTaskScraper.service";
import { SCRAPER_TYPES } from "./modules/scraper/scraper.types";
import { ScraperOrchestrator } from "./modules/scraper/scraper.orchestrator";
import { ScraperAdapter } from "./modules/scraper/scraper.dto";
import { AiPromptParserService } from "./modules/ai/aiPromptParser.service";
import { AI_TYPES } from "./modules/ai/ai.types";
import { TelegramService } from "./modules/telegram/telegram.service";
import { TELEGRAM_TYPES } from "./modules/telegram/telegram.types";
import { TelegramClient } from "./modules/telegram/telegram.client";
import { ScraperCityApolloAdapter } from "./modules/scraper/adapters/scraperCity/scraperCity.adapter";
import { ScruppApolloAdapter } from "./modules/scraper/adapters/scrupp/scrupp.adapter";
import { LeadDbOrchestrator } from "./modules/lead-db/lead-db.orchestrator";
import { SearchTaskLeadDbService } from "./modules/lead-db/searchTaskLeadDb.service";
import { LEAD_DB_TYPES } from "./modules/lead-db/lead-db.types";
import type { LeadDbAdapter } from "./modules/lead-db/lead-db.dto";
import { ScraperCityLeadDbAdapter } from "./modules/lead-db/adapters/scraperCity/scraperCity.adapter";

const container = new Container();

const env = loadEnv();

const allowedTelegramIds = new Set(
	env.TELEGRAM_ALLOWED_USER_IDS.split(",")
		.map((id) => id.trim())
		.filter(Boolean)
);

const isScraperCityEnabled =
	Boolean(env.SCRAPERCITY_API_KEY && env.SCRAPERCITY_API_URL);
const isScruppEnabled = Boolean(env.SCRUPP_SCRAPER_API_KEY && env.SCRUPP_SCRAPER_API_URL);

if (env.NODE_ENV === "production" && allowedTelegramIds.size === 0) {
	throw new Error(
		"TELEGRAM_ALLOWED_USER_IDS must be set in production to avoid exposing the bot publicly"
	);
}

container
	.bind<Set<string>>(TELEGRAM_TYPES.AllowedUserIds)
	.toConstantValue(allowedTelegramIds);

container
	.bind<TelegramClient>(TELEGRAM_TYPES.TelegramClient)
	.toDynamicValue(() => new TelegramClient(env.TELEGRAM_BOT_ACCESS_TOKEN))
	.inSingletonScope();

container
	.bind<TelegramService>(TELEGRAM_TYPES.TelegramService)
	.to(TelegramService)
	.inSingletonScope();

container
	.bind<SearchTaskScraperService>(SCRAPER_TYPES.SearchTaskScraperService)
	.to(SearchTaskScraperService)
	.inSingletonScope();

container
	.bind<ScraperOrchestrator>(SCRAPER_TYPES.ScraperOrchestrator)
	.to(ScraperOrchestrator)
	.inSingletonScope();

container
	.bind<ScraperAdapter>(SCRAPER_TYPES.ScraperAdapter)
	.toDynamicValue(() => {
		return new ScraperCityApolloAdapter(
			env.SCRAPERCITY_API_KEY ?? "",
			isScraperCityEnabled
		);
	})
	.inSingletonScope();

container
	.bind<ScraperAdapter>(SCRAPER_TYPES.ScraperAdapter)
	.toDynamicValue(() => {
		return new ScruppApolloAdapter(
			env.SCRUPP_SCRAPER_API_KEY ?? "",
			isScruppEnabled
		);
	})
	.inSingletonScope();

container
	.bind<AiPromptParserService>(AI_TYPES.AiPromptParserService)
	.toDynamicValue(() => {
		return new AiPromptParserService(env.OPENAI_API_KEY, env.OPENAI_MODEL);
	})
	.inSingletonScope();

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

container
  .bind<LeadDbOrchestrator>(LEAD_DB_TYPES.LeadDbOrchestrator)
  .to(LeadDbOrchestrator)
  .inSingletonScope();

container
	.bind<LeadDbAdapter>(LEAD_DB_TYPES.LeadDbAdapter)
	.toDynamicValue(() => {
		return new ScraperCityLeadDbAdapter(
			env.SCRAPERCITY_API_KEY ?? "",
			isScraperCityEnabled
		);
	})
	.inSingletonScope();

container
  .bind<SearchTaskLeadDbService>(LEAD_DB_TYPES.SearchTaskLeadDbService)
  .to(SearchTaskLeadDbService)
  .inSingletonScope();

export { container };
