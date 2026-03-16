import { Queue } from "bullmq";
import type { Redis } from "ioredis";

import { loadEnv } from "@/config/env";

export const PROFILE_ENRICHMENT_QUEUE_NAME = "profile-enrichment";
export type ProfileEnrichmentJobName = "profileEnrichment.run";

export interface ProfileEnrichmentJobData {
  enrichmentRequestId: string;
  leadId: string;
  linkedinUrl: string;
  triggeredById: string;
}

export function createProfileEnrichmentQueue(redis: Redis) {
  return new Queue<ProfileEnrichmentJobData, void, ProfileEnrichmentJobName>(
    PROFILE_ENRICHMENT_QUEUE_NAME,
    { connection: redis },
  );
}

export function profileEnrichmentJobOptions() {
  const env = loadEnv();

  return {
    // Note: profile enrichment intentionally reuses lead-search env vars for
    // retry config. Add PROFILE_ENRICHMENT_QUEUE_ATTEMPTS/BACKOFF_MS to env.ts
    // when independent tuning is needed.
    attempts: env.LEAD_SEARCH_QUEUE_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.LEAD_SEARCH_QUEUE_BACKOFF_MS,
    },
    removeOnComplete: true,
    removeOnFail: { count: 100, age: 7 * 24 * 3600 },
  };
}
