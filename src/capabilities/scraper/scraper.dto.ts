import { LeadProvider } from "@prisma/client";
import z from "zod";

import { NormalizedLead } from "../shared/leadValidate";

export const ScrapeQuerySchema = z.object({
	apolloUrl: z.string().min(1),
	limit: z.number().int().positive(),
});
export type ScrapeQuery = z.infer<typeof ScrapeQuerySchema>;

export type ScraperRunStatus = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface ScraperStartResult {
	providerRunId: string;
	fileNameHint?: string | null;
}

export interface ScraperStatusResult {
	status: ScraperRunStatus;
	/**
	 * Provider raw status payload (for debugging / responseMeta).
	 * Keep it small; do NOT store huge blobs here.
	 */
	raw?: unknown;
}

export interface ScraperAdapter {
	provider: LeadProvider;

	isEnabled(): boolean;

	/**
	 * How often we should poll provider status (ms).
	 * Example: 30 minutes.
	 */
	pollIntervalMs: number;

	/**
	 * Max poll attempts before timing out the run.
	 * Example: 180 * 30min = 90h.
	 */
	maxPollAttempts: number;

	/**
	 * Start external scraping run and return providerRunId.
	 */
	start(query: ScrapeQuery): Promise<ScraperStartResult>;

	/**
	 * Check provider run status once.
	 */
	checkStatus(providerRunId: string): Promise<ScraperStatusResult>;

	/**
	 * Fetch & normalize leads when status is SUCCEEDED.
	 * Must be idempotent (safe to call twice).
	 */
	fetchLeads(input: {
		providerRunId: string;
		query: ScrapeQuery;
		status?: ScraperStatusResult;
	}): Promise<NormalizedLead[]>;
}
