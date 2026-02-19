import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { container } from "@/container";
import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { PIPELINE_TYPES } from "@/modules/pipeline/pipeline.types";
import type { PipelineExecutor } from "@/modules/pipeline/engine/pipeline.executor";
import {
  PIPELINE_RUN_QUEUE_NAME,
  type PipelineRunJobData,
  type PipelineRunJobName,
} from "./pipeline-run.queue";

export function startPipelineRunWorker(args: {
  redis: Redis;
  concurrency?: number;
  log?: LoggerLike;
}) {
  const lg = ensureLogger(args.log);

  const worker = new Worker<PipelineRunJobData, void, PipelineRunJobName>(
    PIPELINE_RUN_QUEUE_NAME,
    async (job) => {
      const executor = container.get<PipelineExecutor>(
        PIPELINE_TYPES.PipelineExecutor,
      );
      await executor.executePipeline(job.data.pipelineRunId, lg);
    },
    {
      connection: args.redis,
      concurrency: args.concurrency ?? 2,
    },
  );

  worker.on("completed", (job) => {
    lg.info(
      { jobId: job.id, pipelineRunId: job.data.pipelineRunId },
      "Pipeline run job completed",
    );
  });

  worker.on("stalled", (jobId) => {
    lg.warn({ jobId }, "Pipeline run job stalled");
  });

  worker.on("failed", (job, err) => {
    lg.error(
      {
        jobId: job?.id,
        pipelineRunId: job?.data.pipelineRunId,
        err: err.message,
      },
      "Pipeline run job failed",
    );
  });

  worker.on("error", (err) => {
    lg.error({ err: err.message }, "Pipeline run worker error");
  });

  lg.info(
    { queue: PIPELINE_RUN_QUEUE_NAME, concurrency: args.concurrency ?? 2 },
    "Pipeline started",
  );

  return worker;
}
