import { LeadProvider } from "@prisma/client";
import z from "zod";

import { NormalizedLead } from "../shared/leadValidate";

export const ScrapeQuerySchema = z.object({
	apolloUrl: z.string().min(1),
	// `limit` usually comes from LeadSearch.limit, but we allow query to carry it too.
	limit: z.number().int().positive(),
});
export type ScrapeQuery = z.infer<typeof ScrapeQuerySchema>;

export interface ScraperAdapterResult {
	provider: LeadProvider;
	providerRunId?: string | null;
	fileNameHint?: string | null;
	leads: NormalizedLead[];
}

export interface ScraperAdapter {
	provider: LeadProvider;
	isEnabled(): boolean;
	scrape(query: ScrapeQuery): Promise<ScraperAdapterResult>;
}

export interface ScraperOrchestratorOptions {
  providersOrder: LeadProvider[];
  minLeads?: number;
  allowUnderDeliveryFallback?: boolean;
}

export type ScraperAttemptStatus =
  | "SUCCESS"
  | "FAILED"
  | "DISABLED"
  | "NOT_REGISTERED"
  | "UNDER_DELIVERED";

export interface ScraperAttempt {
  provider: LeadProvider;
  status: ScraperAttemptStatus;
  leadsCount?: number;
  providerRunId?: string | null;
  fileNameHint?: string | null;
  errorMessage?: string;
}

/**
 * Hooks allow the orchestrator to stay pure (no Prisma),
 * while the caller (LeadSearchRunnerService) can log LeadSearchRun rows.
 */
export interface ScraperOrchestratorHooks<Ctx = void> {
  onProviderStart?: (provider: LeadProvider) => Promise<Ctx> | Ctx;
  onProviderSuccess?: (
    ctx: Ctx,
    provider: LeadProvider,
    result: ScraperAdapterResult,
    attempt: ScraperAttempt,
  ) => Promise<void> | void;
  onProviderError?: (
    ctx: Ctx | undefined,
    provider: LeadProvider,
    error: unknown,
    attempt: ScraperAttempt,
  ) => Promise<void> | void;
  onProviderSkip?: (
    provider: LeadProvider,
    attempt: ScraperAttempt,
  ) => Promise<void> | void;
}

export interface ScraperOrchestratorResult {
  result: ScraperAdapterResult;
  attempts: ScraperAttempt[];
  errors: Partial<Record<LeadProvider, string>>;
}