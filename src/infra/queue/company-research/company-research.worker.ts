import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger } from "@/infra/observability";

import {
  COMPANY_RESEARCH_QUEUE_NAME,
  type CompanyResearchJobData,
  type CompanyResearchJobName,
} from "./company-research.queue";
import { COMPANY_RESEARCH_TYPES } from "@/modules/company-research/company-research.types";
import type { CompanyResearchRunnerService } from "@/modules/company-research/services/company-research.runner.service";

export function startCompanyResearchWorker(args: {
  redis: Redis;
  concurrency?: number;
}) {
  const lg = ensureLogger();

  const worker = new Worker<
    CompanyResearchJobData,
    void,
    CompanyResearchJobName
  >(
    COMPANY_RESEARCH_QUEUE_NAME,
    async (job: Job<CompanyResearchJobData, void, CompanyResearchJobName>) => {
      const runner = container.get<CompanyResearchRunnerService>(
        COMPANY_RESEARCH_TYPES.CompanyResearchRunnerService,
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
        companyResearchId: job.data.companyResearchId,
        leadId: job.data.leadId,
        company: job.data.company,
      },
      "CompanyResearch job completed",
    );
  });

  worker.on("stalled", (jobId) => {
    lg.warn({ jobId }, "CompanyResearch job stalled");
  });

  worker.on("failed", (job, err) => {
    lg.error(
      {
        err,
        jobId: job?.id ?? null,
        companyResearchId: job?.data?.companyResearchId ?? null,
        leadId: job?.data?.leadId ?? null,
        company: job?.data?.company ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        maxAttempts: job?.opts?.attempts ?? null,
      },
      "CompanyResearch job failed",
    );
  });

  worker.on("error", (err) => {
    lg.error({ err }, "CompanyResearch worker error");
  });

  lg.info(
    { queue: COMPANY_RESEARCH_QUEUE_NAME, concurrency: args.concurrency ?? 2 },
    "CompanyResearch worker started",
  );

  return worker;
}
