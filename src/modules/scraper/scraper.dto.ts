import { ScraperProvider } from "@prisma/client";

import { LeadInput } from "../lead/lead.schemas";

export interface ScrapeQuery {
	apolloUrl: string;
	limit: number;
}

export interface ScraperCityApolloRow {
	id?: string;
	name?: string;
	first_name?: string;
	last_name?: string;
	title?: string;
	company_name?: string;
	company_domain?: string;
	company_website?: string;
	linkedin_url?: string;
	location?: string;
	work_email?: string;
	email?: string;
	[key: string]: unknown;
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
