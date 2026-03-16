import { Queue } from "bullmq";
import type { Redis } from "ioredis";

import { loadEnv } from "@/config/env";

export const COMPANY_RESEARCH_QUEUE_NAME = "company-research";
export type CompanyResearchJobName = "companyResearch.run";

export interface CompanyResearchJobData {
  companyResearchId: string;
  leadId: string;
  company: string;
  companyDomains: string[];
  companyLinkedinUrl: string | null;
  includeLinkedinPosts: boolean;
  recency: "day" | "week" | "month" | "year";
  maxResults: number;
  triggeredById: string;
}

export function createCompanyResearchQueue(redis: Redis) {
  return new Queue<CompanyResearchJobData, void, CompanyResearchJobName>(
    COMPANY_RESEARCH_QUEUE_NAME,
    { connection: redis },
  );
}

export function companyResearchJobOptions() {
  const env = loadEnv();

  return {
    attempts: env.LEAD_SEARCH_QUEUE_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.LEAD_SEARCH_QUEUE_BACKOFF_MS,
    },
    removeOnComplete: true,
    removeOnFail: { count: 100, age: 7 * 24 * 3600 },
  };
}
