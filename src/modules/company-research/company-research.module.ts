import type { Container } from "inversify";

import { COMPANY_RESEARCH_TYPES } from "./company-research.types";
import { CompanyResearchQueryService } from "./services/company-research.query.service";
import { PerplexityClient } from "./services/perplexity.client";

export function registerCompanyResearchModule(container: Container) {
  container
    .bind<PerplexityClient>(COMPANY_RESEARCH_TYPES.PerplexityClient)
    .to(PerplexityClient)
    .inSingletonScope();

  container
    .bind<CompanyResearchQueryService>(
      COMPANY_RESEARCH_TYPES.CompanyResearchQueryService,
    )
    .to(CompanyResearchQueryService)
    .inSingletonScope();
}
