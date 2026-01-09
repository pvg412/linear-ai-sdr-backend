import type { Container } from "inversify";

import { LEAD_RAG_TYPES } from "./lead-rag.types";

import { LeadRagIndexProcessorService } from "./services/lead-rag-index-processor.service";
import { LeadRagIndexSyncService } from "./services/lead-rag-index-sync.service";

export function registerLeadRagModule(container: Container) {
	container
		.bind<LeadRagIndexProcessorService>(
			LEAD_RAG_TYPES.LeadRagIndexProcessorService
		)
		.to(LeadRagIndexProcessorService)
		.inSingletonScope();

	container
		.bind<LeadRagIndexSyncService>(LEAD_RAG_TYPES.LeadRagIndexSyncService)
		.toDynamicValue((ctx) => {
			const processor = ctx.get<LeadRagIndexProcessorService>(
				LEAD_RAG_TYPES.LeadRagIndexProcessorService
			);

			return new LeadRagIndexSyncService({ processor });
		})
		.inSingletonScope();
}
