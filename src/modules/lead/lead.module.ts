import type { Container } from "inversify";

import { LEAD_TYPES } from "./lead.types";
import { LeadRepository } from "./persistence/lead.repository";
import { LeadQueryService } from "./services/lead.query.service";

export function registerLeadModule(container: Container) {
	container
		.bind<LeadRepository>(LEAD_TYPES.LeadRepository)
		.to(LeadRepository)
		.inSingletonScope();

	container
		.bind<LeadQueryService>(LEAD_TYPES.LeadQueryService)
		.to(LeadQueryService)
		.inSingletonScope();
}
