import type { Container } from "inversify";

import { LeadDbAdapter } from "./lead-db.dto";
import { LEAD_DB_TYPES } from "./lead-db.types";
import { loadEnv } from "@/config/env";
import { LeadDbOrchestrator } from "./lead-db.orchestrator";
import { SearchLeadsLeadDbAdapter } from "./providers/searchleads/searchleads.adapter";
import { ScraperCityLeadDbAdapter } from "./providers/scrapercity/scrapercity.adapter";

const env = loadEnv();

const isSearchLeadsEnabled = Boolean(
	env.SEARCH_LEADS_API_KEY && env.SEARCH_LEADS_API_URL
);

const isScraperCityEnabled = Boolean(
	env.SCRAPERCITY_API_KEY && env.SCRAPERCITY_API_URL
);

export function registerLeadDbModule(container: Container) {
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
		.bind<LeadDbOrchestrator>(LEAD_DB_TYPES.LeadDbOrchestrator)
		.to(LeadDbOrchestrator)
		.inSingletonScope();
}
