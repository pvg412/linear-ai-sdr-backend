import { ScraperProvider } from "@prisma/client";

import { LeadInput } from "../lead/lead.schemas";

export interface ScrapeQuery {
	apolloUrl: string;
	limit: number;
}

export type NormalizedLeadForCreate = LeadInput;

export interface ScraperAdapterResult {
	provider: ScraperProvider;
	providerRunId?: string | null;
	fileNameHint?: string | null;
	leads: NormalizedLeadForCreate[];
}

export interface ScraperAdapter {
	provider: ScraperProvider;
	isEnabled(): boolean;
	scrape(query: ScrapeQuery): Promise<ScraperAdapterResult>;
}

export interface ScraperOrchestratorOptions {
	providersOrder: ScraperProvider[];
	minLeads?: number;
	allowUnderDeliveryFallback?: boolean;
}