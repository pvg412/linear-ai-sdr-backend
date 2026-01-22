import type { Container } from "inversify";

import { loadEnv } from "@/config/env";
import { SCRAPER_TYPES } from "./scraper.types";
import { ScraperAdapter } from "./scraper.dto";
import { ScraperOrchestrator } from "./scraper.orchestrator";
import { ApifyLinkedinProfileSearchScraperAdapter } from "./providers/apify-linkedin-profile-search/apify-linkedin-profile-search.adapter";
import { ScraperCityScraperAdapter } from "./providers/scrapercity/scrapercity.adapter";

const env = loadEnv();

const isApifyEnabled = Boolean(env.APIFY_TOKEN);

const isScraperCityEnabled = Boolean(
  env.SCRAPERCITY_API_KEY && env.SCRAPERCITY_API_URL,
);

export function registerScraperModule(container: Container) {
  container
    .bind<ScraperOrchestrator>(SCRAPER_TYPES.ScraperOrchestrator)
    .to(ScraperOrchestrator)
    .inSingletonScope();

  container
    .bind<ScraperAdapter>(SCRAPER_TYPES.ScraperAdapter)
    .toDynamicValue(() => {
      return new ApifyLinkedinProfileSearchScraperAdapter(
        env.APIFY_TOKEN ?? "",
        isApifyEnabled,
        env.APIFY_MONGODB_CONNECTION_STRING ?? "",
      );
    })
    .inSingletonScope();

  container
    .bind<ScraperAdapter>(SCRAPER_TYPES.ScraperAdapter)
    .toDynamicValue(() => {
      return new ScraperCityScraperAdapter(
        env.SCRAPERCITY_API_KEY ?? "",
        isScraperCityEnabled,
      );
    })
    .inSingletonScope();
}
