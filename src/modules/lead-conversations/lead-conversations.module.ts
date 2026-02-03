import type { Container } from "inversify";

import { LEAD_CONVERSATIONS_TYPES } from "./lead-conversations.types";

import { LeadConversationsRepository } from "./persistence/lead-conversations.repository";
import { LeadConversationsService } from "./services/lead-conversations.service";
import { OutreachCadenceService } from "./services/outreach-cadence.service";

export function registerLeadConversationsModule(container: Container) {
  container
    .bind<LeadConversationsRepository>(
      LEAD_CONVERSATIONS_TYPES.LeadConversationsRepository,
    )
    .to(LeadConversationsRepository)
    .inSingletonScope();

  container
    .bind<LeadConversationsService>(
      LEAD_CONVERSATIONS_TYPES.LeadConversationsService,
    )
    .to(LeadConversationsService)
    .inSingletonScope();

  container
    .bind<OutreachCadenceService>(
      LEAD_CONVERSATIONS_TYPES.OutreachCadenceService,
    )
    .to(OutreachCadenceService)
    .inSingletonScope();
}
