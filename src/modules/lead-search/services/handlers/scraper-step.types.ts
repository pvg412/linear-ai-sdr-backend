// Shared types for scraper step handlers

import type { Job } from "bullmq";
import type { LeadProvider, LeadSearchKind } from "@prisma/client";

import type { LoggerLike } from "@/infra/observability";
import type {
  ApifyScraperQuery,
  ScraperAdapter,
  ScraperStatusResult,
  ScrapeQuery,
} from "@/capabilities/scraper/scraper.dto";
import type {
  LeadSearchJobData,
  LeadSearchJobName,
  LeadSearchScraperJobState,
} from "@/infra/queue/lead-search/lead-search.queue";

// Re-export for convenience
export type { LeadSearchScraperJobState as ScraperState } from "@/infra/queue/lead-search/lead-search.queue";

export interface ScraperStepContext {
  job: Job<LeadSearchJobData, void, LeadSearchJobName>;
  token: string;
  log: LoggerLike;
  leadSearchId: string;
  threadId: string | null;
  provider: LeadProvider;
  kind: LeadSearchKind;
  adapter: ScraperAdapter;
  scrapeQuery: ScrapeQuery;
  state: LeadSearchScraperJobState;
  t0: bigint;
  jobAttemptsMade: number;
  jobMaxAttempts: number | null;
  isLastJobAttempt: boolean;
  triggeredById: string | null;
  leadSearchLimit: number;
}

export interface StepResult {
  done: boolean;
  nextState?: LeadSearchScraperJobState;
  delayMs?: number;
}

export function isApifyScrapeQuery(q: unknown): q is ApifyScraperQuery {
  return (
    typeof q === "object" &&
    q !== null &&
    typeof (q as Record<string, unknown>)["limit"] === "number" &&
    !("apolloUrl" in (q as Record<string, unknown>))
  );
}

export function isRateLimitedStatus(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  const hint = typeof r["_hint"] === "string" ? r["_hint"].toLowerCase() : "";
  if (hint.includes("rate_limited")) return true;

  const statusMessage =
    typeof r["statusMessage"] === "string"
      ? r["statusMessage"].toLowerCase()
      : "";
  return (
    statusMessage.includes("rate limited") ||
    statusMessage.includes("rate limit")
  );
}

export function canComputeApifyResume(
  adapter: ScraperAdapter,
): adapter is ScraperAdapter & {
  getRateLimitResumePlan: (input: {
    providerRunId: string;
    query: ApifyScraperQuery;
    status?: ScraperStatusResult;
    now?: Date;
  }) => Promise<{
    waitMs: number;
    datasetItemCount: number;
    lastScrapedPage: number;
    nextStartPage: number;
    remainingTakePages: number;
  }>;
} {
  return (
    typeof (adapter as unknown as Record<string, unknown>)[
    "getRateLimitResumePlan"
    ] === "function"
  );
}

export const USER_MESSAGES = {
  retryable:
    "External service temporarily unavailable. We'll retry automatically.",
  final:
    "Failed to search: external service not responding. Please try again later.",
} as const;
