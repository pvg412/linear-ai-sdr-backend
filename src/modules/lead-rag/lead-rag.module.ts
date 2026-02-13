import type { Container } from "inversify";
import type { Queue } from "bullmq";

import { LEAD_RAG_TYPES } from "./lead-rag.types";
import { QUEUE_TYPES } from "@/infra/queue/queue.types";

import { LeadRagIndexProcessorService } from "./services/lead-rag-index-processor.service";
import { LeadRagIndexSyncService } from "./services/lead-rag-index-sync.service";
import type {
  LeadRagIndexJobData,
  LeadRagIndexJobName,
} from "@/infra/queue/lead-rag/lead-rag-index.queue";

export function registerLeadRagModule(container: Container) {
  container
    .bind<LeadRagIndexProcessorService>(
      LEAD_RAG_TYPES.LeadRagIndexProcessorService,
    )
    .to(LeadRagIndexProcessorService)
    .inSingletonScope();

  container
    .bind<LeadRagIndexSyncService>(LEAD_RAG_TYPES.LeadRagIndexSyncService)
    .toDynamicValue((ctx) => {
      const processor = ctx.get<LeadRagIndexProcessorService>(
        LEAD_RAG_TYPES.LeadRagIndexProcessorService,
      );

      // Try to get the queue if Redis is configured
      let queue: Queue<LeadRagIndexJobData, void, LeadRagIndexJobName> | undefined;
      try {
        queue = ctx.get<Queue<LeadRagIndexJobData, void, LeadRagIndexJobName>>(
          QUEUE_TYPES.LeadRagIndexQueue,
        );
      } catch {
        // Queue not registered (Redis not configured) - will run inline
        queue = undefined;
      }

      return new LeadRagIndexSyncService({ processor, queue });
    })
    .inSingletonScope();
}
