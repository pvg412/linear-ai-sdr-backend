import type { Container } from "inversify";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { tryCreateRedisClient } from "./redis.client";
import { QUEUE_TYPES } from "./queue.types";
import { createLeadSearchQueue } from "./lead-search/lead-search.queue";
import {
  LeadSearchJobData,
  LeadSearchJobName,
} from "./lead-search/lead-search.queue";
import {
  createLeadRagIndexQueue,
  LeadRagIndexJobData,
  LeadRagIndexJobName,
} from "./lead-rag/lead-rag-index.queue";
import {
  createProfileEnrichmentQueue,
  ProfileEnrichmentJobData,
  ProfileEnrichmentJobName,
} from "./profile-enrichment/profile-enrichment.queue";
import {
  createPipelineRunQueue,
  type PipelineRunJobData,
  type PipelineRunJobName,
} from "./pipeline-run/pipeline-run.queue";

const redis = tryCreateRedisClient();

export function registerQueueModule(container: Container) {
  if (redis) {
    container.bind<Redis>(QUEUE_TYPES.Redis).toConstantValue(redis);

    const leadSearchQueue = createLeadSearchQueue(redis);
    const leadRagIndexQueue = createLeadRagIndexQueue(redis);

    container
      .bind<
        Queue<LeadSearchJobData, void, LeadSearchJobName>
      >(QUEUE_TYPES.LeadSearchQueue)
      .toConstantValue(leadSearchQueue);

    container
      .bind<
        Queue<LeadRagIndexJobData, void, LeadRagIndexJobName>
      >(QUEUE_TYPES.LeadRagIndexQueue)
      .toConstantValue(leadRagIndexQueue);

    const profileEnrichmentQueue = createProfileEnrichmentQueue(redis);

    container
      .bind<
        Queue<ProfileEnrichmentJobData, void, ProfileEnrichmentJobName>
      >(QUEUE_TYPES.ProfileEnrichmentQueue)
      .toConstantValue(profileEnrichmentQueue);

    const pipelineRunQueue = createPipelineRunQueue(redis);
    container
      .bind<
        Queue<PipelineRunJobData, void, PipelineRunJobName>
      >(QUEUE_TYPES.PipelineRunQueue)
      .toConstantValue(pipelineRunQueue);
  } else {
    console.warn("[queue] REDIS_URL not set; LeadSearch will run inline");
  }
}
