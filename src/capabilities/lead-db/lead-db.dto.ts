import { ScraperProvider } from "@prisma/client";

import { LeadInput } from "@/modules/lead/lead.schemas";

export interface LeadDbCanonicalFilters {
  seniorityLevel?: string;
  functionDept?: string;

  personTitles?: string[];
  personCountry?: string;
  personState?: string;
  personCities?: string[];

  companyIndustry?: string;
  companySize?: string;
  companyCountry?: string;
  companyState?: string;
  companyCities?: string[];

  companyDomains?: string[];
  companyKeywords?: string[];

  hasPhone?: boolean;
}

export interface LeadDbQuery {
  limit: number;
  fileName?: string;

  /**
   * Preferred (new): canonical filters.
   */
  filters?: LeadDbCanonicalFilters;

  /**
   * Backward-compatible (old): "Apollo-like" object, still supported.
   */
  apolloFilters?: Record<string, unknown>;

  /**
   * Rare: manual provider-specific payload override.
   * Example: providerOverrides[ScraperProvider.SEARCH_LEADS] = { ...SearchLeadsFilter }
   */
  providerOverrides?: Partial<Record<ScraperProvider, unknown>>;
}

export type NormalizedLeadForCreate = LeadInput;

export interface LeadDbAdapterResult {
  provider: ScraperProvider;
  providerRunId?: string | null;
  fileNameHint?: string | null;
  leads: NormalizedLeadForCreate[];
}

export interface LeadDbAdapter {
  provider: ScraperProvider;
  isEnabled(): boolean;
  scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult>;
}

export interface LeadDbOrchestratorOptions {
  providersOrder: ScraperProvider[];
}

export interface LeadDbOrchestratorResult {
  providerResults: LeadDbAdapterResult[];
  errors: Partial<Record<ScraperProvider, string>>;
}
