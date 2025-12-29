import "reflect-metadata";
import { Container } from "inversify";
import Redis from "ioredis";
import type { Queue } from "bullmq";

import { loadEnv } from "./config/env";
import {
	createLeadSearchQueue,
	LeadSearchJobData,
	LeadSearchJobName,
} from "./infra/queue/lead-search.queue";
import { tryCreateRedisClient } from "./infra/queue/redis.client";
import { QUEUE_TYPES } from "./infra/queue/queue.types";
import { REALTIME_TYPES } from "./infra/realtime/realtime.types";
import { RealtimeHub } from "./infra/realtime/realtimeHub";
import { SCRAPER_TYPES } from "./capabilities/scraper/scraper.types";
import { ScraperOrchestrator } from "./capabilities/scraper/scraper.orchestrator";
import { ScraperAdapter } from "./capabilities/scraper/scraper.dto";
import { AiPromptParserService } from "./modules/ai/ai-prompt-parser.service";
import { AI_TYPES } from "./modules/ai/ai.types";
import { ScraperCityScraperAdapter } from "./capabilities/scraper/providers/scrapercity/scrapercity.adapter";
import { LeadDbOrchestrator } from "./capabilities/lead-db/lead-db.orchestrator";
import { LEAD_DB_TYPES } from "./capabilities/lead-db/lead-db.types";
import type { LeadDbAdapter } from "./capabilities/lead-db/lead-db.dto";
import { ScraperCityLeadDbAdapter } from "./capabilities/lead-db/providers/scrapercity/scrapercity.adapter";
import { SearchLeadsLeadDbAdapter } from "./capabilities/lead-db/providers/searchleads/searchleads.adapter";
import { ChatCommandService } from "./modules/chat/services/chat.command.service";
import { CHAT_TYPES } from "./modules/chat/chat.types";
import { ChatQueryService } from "./modules/chat/services/chat.query.service";
import { ChatRepository } from "./modules/chat/persistence/chat.repository";
import { ChatAiPromptParser } from "./modules/chat/parsers/chat.promptParser.ai";
import { LEAD_TYPES } from "./modules/lead/lead.types";
import { LeadRepository } from "./modules/lead/persistence/lead.repository";
import { LeadQueryService } from "./modules/lead/services/lead.query.service";
import { LeadSearchRunnerService } from "./modules/lead-search/lead-search.runner.service";
import { LEAD_SEARCH_TYPES } from "./modules/lead-search/lead-search.types";
import { LeadSearchRepository } from "./modules/lead-search/persistence/lead-search.repository";
import { LeadSearchRunRepository } from "./modules/lead-search/persistence/lead-search-run.repository";
import { LeadSearchNotifierService } from "./modules/lead-search/services/lead-search.notifier.service";
import { LeadSearchLeadPersisterService } from "./modules/lead-search/services/lead-search.lead-persister.service";
import { LeadDbLeadSearchHandler } from "./modules/lead-search/services/lead-db.lead-search.handler";
import { ScraperInlineLeadSearchHandler } from "./modules/lead-search/services/scraper-inline.lead-search.handler";
import { ScraperStepLeadSearchHandler } from "./modules/lead-search/services/scraper-step.lead-search.handler";

const redis = tryCreateRedisClient();

const container = new Container();

const env = loadEnv();

const isOpenAiEnabled = Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL);

const isScraperCityEnabled = Boolean(
	env.SCRAPERCITY_API_KEY && env.SCRAPERCITY_API_URL
);
const isSearchLeadsEnabled = Boolean(
	env.SEARCH_LEADS_API_KEY && env.SEARCH_LEADS_API_URL
);

if (redis) {
	container.bind<Redis>(QUEUE_TYPES.Redis).toConstantValue(redis);

	const leadSearchQueue = createLeadSearchQueue(redis);

	container
		.bind<Queue<LeadSearchJobData, void, LeadSearchJobName>>(
			QUEUE_TYPES.LeadSearchQueue
		)
		.toConstantValue(leadSearchQueue);
} else {
	console.warn("[queue] REDIS_URL not set; LeadSearch will run inline");
}

container
	.bind<RealtimeHub>(REALTIME_TYPES.RealtimeHub)
	.to(RealtimeHub)
	.inSingletonScope();

container
	.bind<ChatRepository>(CHAT_TYPES.ChatRepository)
	.to(ChatRepository)
	.inSingletonScope();

container
	.bind<ChatCommandService>(CHAT_TYPES.ChatCommandService)
	.to(ChatCommandService)
	.inSingletonScope();

container
	.bind<ChatQueryService>(CHAT_TYPES.ChatQueryService)
	.to(ChatQueryService)
	.inSingletonScope();

container
	.bind<ChatAiPromptParser>(CHAT_TYPES.ChatPromptParser)
	.to(ChatAiPromptParser)
	.inSingletonScope();

container
	.bind<LeadRepository>(LEAD_TYPES.LeadRepository)
	.to(LeadRepository)
	.inSingletonScope();

container
	.bind<LeadQueryService>(LEAD_TYPES.LeadQueryService)
	.to(LeadQueryService)
	.inSingletonScope();

container
	.bind<LeadSearchRunnerService>(LEAD_SEARCH_TYPES.LeadSearchRunnerService)
	.to(LeadSearchRunnerService)
	.inSingletonScope();

container
	.bind<LeadSearchRunRepository>(LEAD_SEARCH_TYPES.LeadSearchRunRepository)
	.to(LeadSearchRunRepository)
	.inSingletonScope();

container
	.bind<LeadSearchNotifierService>(LEAD_SEARCH_TYPES.LeadSearchNotifierService)
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

container
	.bind<ScraperOrchestrator>(SCRAPER_TYPES.ScraperOrchestrator)
	.to(ScraperOrchestrator)
	.inSingletonScope();

container
	.bind<ScraperAdapter>(SCRAPER_TYPES.ScraperAdapter)
	.toDynamicValue(() => {
		return new ScraperCityScraperAdapter(
			env.SCRAPERCITY_API_KEY ?? "",
			isScraperCityEnabled
		);
	})
	.inSingletonScope();

container
	.bind<LeadDbAdapter>(LEAD_DB_TYPES.LeadDbAdapter)
	.toDynamicValue(
		() =>
			new SearchLeadsLeadDbAdapter(
				env.SEARCH_LEADS_API_KEY ?? "",
				isSearchLeadsEnabled
			)
	)
	.inSingletonScope();

if (isOpenAiEnabled) {
	container
		.bind<AiPromptParserService>(AI_TYPES.AiPromptParserService)
		.toDynamicValue(() => {
			return new AiPromptParserService(env.OPENAI_API_KEY!, env.OPENAI_MODEL!);
		})
		.inSingletonScope();
}

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

export { container };
