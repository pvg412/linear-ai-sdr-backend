export interface ScraperCityStartResponse {
  runId: string;
  message?: string;
}

export interface ScraperCityStatusResponse {
  status: string; // RUNNING | SUCCEEDED | FAILED
  statusMessage?: string;
  handled?: number;
  runTimeSecs?: number;
  outputUrl?: string | null; // "/api/downloads/<runId>"
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
