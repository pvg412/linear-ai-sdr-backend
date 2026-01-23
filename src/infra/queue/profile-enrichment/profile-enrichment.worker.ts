import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger } from "@/infra/observability";

import {
  PROFILE_ENRICHMENT_QUEUE_NAME,
  type ProfileEnrichmentJobData,
  type ProfileEnrichmentJobName,
} from "./profile-enrichment.queue";
import { PROFILE_ENRICHMENT_TYPES } from "@/modules/profile-enrichment/profile-enrichment.types";
import type { ProfileEnrichmentRunnerService } from "@/modules/profile-enrichment/services/profile-enrichment.runner.service";

export function startProfileEnrichmentWorker(args: {
  redis: Redis;
  concurrency?: number;
}) {
  const lg = ensureLogger();

  const worker = new Worker<
    ProfileEnrichmentJobData,
    void,
    ProfileEnrichmentJobName
  >(
    PROFILE_ENRICHMENT_QUEUE_NAME,
    async (job: Job<ProfileEnrichmentJobData, void, ProfileEnrichmentJobName>) => {
      const runner = container.get<ProfileEnrichmentRunnerService>(
        PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentRunnerService,
      );

      await runner.processJob(job.data, lg);
    },
    {
      connection: args.redis,
      concurrency: args.concurrency ?? 2,
    },
  );

  worker.on("completed", (job) => {
    lg.info(
      {
        jobId: job.id,
        enrichmentRequestId: job.data.enrichmentRequestId,
        leadId: job.data.leadId,
      },
      "ProfileEnrichment job completed",
    );
  });

  worker.on("stalled", (jobId) => {
    lg.warn({ jobId }, "ProfileEnrichment job stalled");
  });

  worker.on("failed", (job, err) => {
    lg.error(
      {
        err,
        jobId: job?.id ?? null,
        enrichmentRequestId: job?.data?.enrichmentRequestId ?? null,
        leadId: job?.data?.leadId ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        maxAttempts: job?.opts?.attempts ?? null,
      },
      "ProfileEnrichment job failed",
    );
  });

  worker.on("error", (err) => {
    lg.error({ err }, "ProfileEnrichment worker error");
  });

  lg.info(
    { queue: PROFILE_ENRICHMENT_QUEUE_NAME, concurrency: args.concurrency ?? 2 },
    "ProfileEnrichment worker started",
  );

  return worker;
}
