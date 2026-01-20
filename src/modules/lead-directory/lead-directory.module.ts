import type { Container } from "inversify";

import { LEAD_DIRECTORY_TYPES } from "./lead-directory.types";
import { LeadDirectoryRepository } from "./persistence/lead-directory.repository";
import { LeadDirectoryCommandService } from "./services/lead-directory.command.service";
import { LeadDirectoryQueryService } from "./services/lead-directory.query.service";
import {
  LeadDirectoryMentionResolver,
  LeadDirectoryMentionResolverService,
} from "./services/lead-directory-mention-resolver.service";

export function registerLeadDirectoryModule(container: Container) {
  container
    .bind<LeadDirectoryRepository>(LEAD_DIRECTORY_TYPES.LeadDirectoryRepository)
    .to(LeadDirectoryRepository)
    .inSingletonScope();

  container
    .bind<LeadDirectoryCommandService>(
      LEAD_DIRECTORY_TYPES.LeadDirectoryCommandService,
    )
    .to(LeadDirectoryCommandService)
    .inSingletonScope();

  container
    .bind<LeadDirectoryQueryService>(
      LEAD_DIRECTORY_TYPES.LeadDirectoryQueryService,
    )
    .to(LeadDirectoryQueryService)
    .inSingletonScope();

  container
    .bind<LeadDirectoryMentionResolver>(
      LEAD_DIRECTORY_TYPES.LeadDirectoryMentionResolver,
    )
    .to(LeadDirectoryMentionResolverService)
    .inSingletonScope();
}
