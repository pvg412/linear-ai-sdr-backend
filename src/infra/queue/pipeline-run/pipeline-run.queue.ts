import { Queue } from "bullmq";
import type { Redis } from "ioredis";

import { loadEnv } from "@/config/env";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

export const PIPELINE_RUN_QUEUE_NAME = "pipeline-runs";

/* ------------------------------------------------------------------ */
/*  Job types                                                         */
/* ------------------------------------------------------------------ */

export type PipelineRunJobName = "pipeline.execute";

export type PipelineRunJobData = {
  pipelineRunId: string;
};

/* ------------------------------------------------------------------ */
/*  Queue factory                                                     */
/* ------------------------------------------------------------------ */

export function createPipelineRunQueue(redis: Redis) {
  return new Queue<PipelineRunJobData, void, PipelineRunJobName>(
    PIPELINE_RUN_QUEUE_NAME,
    { connection: redis },
  );
}

/* ------------------------------------------------------------------ */
/*  Default job options                                                */
/* ------------------------------------------------------------------ */

export function pipelineRunJobOptions() {
  const env = loadEnv();
  return {
    attempts: env.PIPELINE_QUEUE_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.PIPELINE_QUEUE_BACKOFF_MS,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
}
