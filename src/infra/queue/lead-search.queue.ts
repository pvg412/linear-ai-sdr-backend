import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { LeadProvider } from "@prisma/client";

import { loadEnv } from "@/config/env";
import { ScraperRunStatus } from "@/capabilities/scraper/scraper.dto";

export const LEAD_SEARCH_QUEUE_NAME = "lead-search";
export type LeadSearchJobName = "leadSearch.run";

export type LeadSearchScraperStep = "INIT" | "POLL" | "FETCH";

export interface LeadSearchScraperJobState {
  step: LeadSearchScraperStep;

  providerIndex: number;
  providersOrder: LeadProvider[];

  runId?: string | null;
  providerRunId?: string | null;

  pollAttempt: number;
  lastStatus?: ScraperRunStatus | null;

  /**
   * Used only for recovery decisions. Stored in Redis.
   */
  initAtMs?: number | null;
}

export type LeadSearchJobData = {
  leadSearchId: string;
  triggeredById?: string | null;

  /**
   * Only for SCRAPER long-running flow.
   */
  scraper?: LeadSearchScraperJobState;
};

const env = loadEnv();

export function createLeadSearchQueue(redis: Redis) {
  return new Queue<LeadSearchJobData, void, LeadSearchJobName>(LEAD_SEARCH_QUEUE_NAME, {
    connection: redis,
  });
}

export function leadSearchJobOptions() {
  const attempts = env.LEAD_SEARCH_QUEUE_ATTEMPTS;
  const backoffMs = env.LEAD_SEARCH_QUEUE_BACKOFF_MS;

  return {
    attempts,
    backoff: { type: "exponential" as const, delay: backoffMs },
    removeOnComplete: true,
    removeOnFail: false,
  };
}
