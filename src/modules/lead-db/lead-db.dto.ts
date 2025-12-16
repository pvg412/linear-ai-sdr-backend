import { ScraperProvider } from "@prisma/client";
import { LeadInput } from "../lead/lead.schemas";

export interface LeadDbApolloFilters {
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
  /**
   * Desired number of leads (final). Provider may request more (e.g. min 500).
   */
  limit: number;

  /**
   * filters for /apollo-filters
   */
  apolloFilters?: LeadDbApolloFilters;

  /**
   * Export name for ScraperCity (max 50 characters).
   */
  fileName?: string;
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
