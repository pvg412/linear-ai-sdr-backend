import type { Container } from "inversify";

import { PROFILE_ENRICHMENT_TYPES } from "./profile-enrichment.types";
import { ProfileEnrichmentRepository } from "./persistence/profile-enrichment.repository";
import { ProfileEnrichmentApifyClient } from "./services/profile-enrichment-apify.client";
import { ProfileEnrichmentCommandService } from "./services/profile-enrichment.command.service";
import { ProfileEnrichmentQueryService } from "./services/profile-enrichment.query.service";
import { ProfileEnrichmentRunnerService } from "./services/profile-enrichment.runner.service";

export function registerProfileEnrichmentModule(container: Container): void {
  container
    .bind<ProfileEnrichmentRepository>(
      PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentRepository,
    )
    .to(ProfileEnrichmentRepository)
    .inSingletonScope();

  container
    .bind<ProfileEnrichmentApifyClient>(
      PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentApifyClient,
    )
    .to(ProfileEnrichmentApifyClient)
    .inSingletonScope();

  container
    .bind<ProfileEnrichmentCommandService>(
      PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentCommandService,
    )
    .to(ProfileEnrichmentCommandService)
    .inSingletonScope();

  container
    .bind<ProfileEnrichmentQueryService>(
      PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentQueryService,
    )
    .to(ProfileEnrichmentQueryService)
    .inSingletonScope();

  container
    .bind<ProfileEnrichmentRunnerService>(
      PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentRunnerService,
    )
    .to(ProfileEnrichmentRunnerService)
    .inSingletonScope();
}
