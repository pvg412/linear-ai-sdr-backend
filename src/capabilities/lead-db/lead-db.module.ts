import type { Container } from "inversify";
import type { Redis } from "ioredis";

import { LeadDbAdapter } from "./lead-db.dto";
import { LEAD_DB_TYPES } from "./lead-db.types";
import { loadEnv } from "@/config/env";
import { LeadDbOrchestrator } from "./lead-db.orchestrator";
import { SearchLeadsLeadDbAdapter } from "./providers/searchleads/searchleads.adapter";
import { ScraperCityLeadDbAdapter } from "./providers/scrapercity/scrapercity.adapter";
import { SearchLeadsLimiter } from "./providers/searchleads/searchleads.limiter";
import { ScraperCityLimiter } from "./providers/scrapercity/scrapercity.limiter";
import { QUEUE_TYPES } from "@/infra/queue/queue.types";

const env = loadEnv();

const isSearchLeadsEnabled = Boolean(
  env.SEARCH_LEADS_API_KEY && env.SEARCH_LEADS_API_URL,
);

const isScraperCityEnabled = Boolean(
  env.SCRAPERCITY_API_KEY && env.SCRAPERCITY_API_URL,
);

export function registerLeadDbModule(container: Container) {
  let redis: Redis | null = null;
  try {
    redis = container.get<Redis>(QUEUE_TYPES.Redis);
  } catch {
    redis = null;
  }

  const searchLeadsLimiter = new SearchLeadsLimiter(redis);
  const scraperCityLimiter = new ScraperCityLimiter(redis);

  container
    .bind<LeadDbAdapter>(LEAD_DB_TYPES.LeadDbAdapter)
    .toDynamicValue(
      () =>
        new SearchLeadsLeadDbAdapter(
          env.SEARCH_LEADS_API_KEY ?? "",
          isSearchLeadsEnabled,
          searchLeadsLimiter,
        ),
    )
    .inSingletonScope();

  container
    .bind<LeadDbAdapter>(LEAD_DB_TYPES.LeadDbAdapter)
    .toDynamicValue(() => {
      return new ScraperCityLeadDbAdapter(
        env.SCRAPERCITY_API_KEY ?? "",
        isScraperCityEnabled,
        scraperCityLimiter,
      );
    })
    .inSingletonScope();

  container
    .bind<LeadDbOrchestrator>(LEAD_DB_TYPES.LeadDbOrchestrator)
    .to(LeadDbOrchestrator)
    .inSingletonScope();
}
