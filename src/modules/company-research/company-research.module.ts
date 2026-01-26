import type { Container } from "inversify";

import { COMPANY_RESEARCH_TYPES } from "./company-research.types";
import { CompanyResearchQueryService } from "./services/company-research.query.service";
import { CompanyResearchCommandService } from "./services/company-research.command.service";
import { CompanyResearchRunnerService } from "./services/company-research.runner.service";
import { CompanyResearchRepository } from "./persistence/company-research.repository";
import { PerplexityClient } from "./services/perplexity.client";
import { LinkedinPostsApifyClient } from "./services/linkedin-posts-apify.client";

export function registerCompanyResearchModule(container: Container) {
  // Repository
  container
    .bind<CompanyResearchRepository>(
      COMPANY_RESEARCH_TYPES.CompanyResearchRepository,
    )
    .to(CompanyResearchRepository)
    .inSingletonScope();

  // API Clients
  container
    .bind<PerplexityClient>(COMPANY_RESEARCH_TYPES.PerplexityClient)
    .to(PerplexityClient)
    .inSingletonScope();

  container
    .bind<LinkedinPostsApifyClient>(
      COMPANY_RESEARCH_TYPES.LinkedinPostsApifyClient,
    )
    .to(LinkedinPostsApifyClient)
    .inSingletonScope();

  // Services
  container
    .bind<CompanyResearchQueryService>(
      COMPANY_RESEARCH_TYPES.CompanyResearchQueryService,
    )
    .to(CompanyResearchQueryService)
    .inSingletonScope();

  container
    .bind<CompanyResearchCommandService>(
      COMPANY_RESEARCH_TYPES.CompanyResearchCommandService,
    )
    .to(CompanyResearchCommandService)
    .inSingletonScope();

  container
    .bind<CompanyResearchRunnerService>(
      COMPANY_RESEARCH_TYPES.CompanyResearchRunnerService,
    )
    .to(CompanyResearchRunnerService)
    .inSingletonScope();
}
