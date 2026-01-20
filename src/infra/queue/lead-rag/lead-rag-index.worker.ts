// src/infra/queue/lead-rag-index.worker.ts
import { DelayedError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger } from "@/infra/observability";

import {
  LEAD_RAG_INDEX_QUEUE_NAME,
  type LeadRagIndexJobData,
  type LeadRagIndexJobName,
} from "./lead-rag-index.queue";

import { LEAD_RAG_TYPES } from "@/modules/lead-rag/lead-rag.types";
import { LeadRagIndexProcessorService } from "@/modules/lead-rag/services/lead-rag-index-processor.service";

function isBullMqControlError(err: unknown): boolean {
  return err instanceof DelayedError;
}

export function startLeadRagIndexWorker(args: {
  redis: Redis;
  concurrency?: number;
}) {
  const lg = ensureLogger();

  const worker = new Worker<LeadRagIndexJobData, void, LeadRagIndexJobName>(
    LEAD_RAG_INDEX_QUEUE_NAME,
    async (job: Job<LeadRagIndexJobData, void, LeadRagIndexJobName>) => {
      const processor = container.get<LeadRagIndexProcessorService>(
        LEAD_RAG_TYPES.LeadRagIndexProcessorService,
      );

      if (job.name === "leadRag.upsertLead") {
        await processor.upsertLeadNow({
          ownerId: job.data.ownerId,
          leadId: job.data.leadId,
          log: lg,
        });
        return;
      }

      if (job.name === "leadRag.deleteLead") {
        await processor.deleteLeadNow({
          ownerId: job.data.ownerId,
          leadId: job.data.leadId,
          log: lg,
        });
        return;
      }

      throw new Error(`Unknown job name: ${String(job.name)}`);
    },
    {
      connection: args.redis,
      concurrency: args.concurrency ?? 4,
    },
  );

  worker.on("completed", (job) => {
    lg.info(
      {
        jobId: job.id,
        name: job.name,
        ownerId: job.data.ownerId,
        leadId: job.data.leadId,
      },
      "LeadRagIndex job completed",
    );
  });

  worker.on("stalled", (jobId) => {
    lg.warn({ jobId }, "LeadRagIndex job stalled");
  });

  worker.on("failed", (job, err) => {
    if (isBullMqControlError(err)) return;

    lg.error(
      {
        err,
        jobId: job?.id ?? null,
        name: job?.name ?? null,
        ownerId: job?.data?.ownerId ?? null,
        leadId: job?.data?.leadId ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        maxAttempts: job?.opts?.attempts ?? null,
      },
      "LeadRagIndex job failed",
    );
  });

  worker.on("error", (err) => {
    lg.error({ err }, "LeadRagIndex worker error");
  });

  lg.info(
    { queue: LEAD_RAG_INDEX_QUEUE_NAME, concurrency: args.concurrency ?? 4 },
    "LeadRagIndex worker started",
  );

  return worker;
}
