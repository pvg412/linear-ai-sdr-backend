export interface SearchLeadsFilter {
  page?: number;
  per_page?: number;

  person_titles?: string[];
  include_similar_titles?: boolean;

  person_seniorities?: string[];
  person_department_or_subdepartments?: string[];

  organization_num_employees_ranges?: string[];
  organization_industry_display_name?: string[];

  company_level_keyword?: {
    sources?: Array<{ mode?: string; source?: string }>;
    content?: string[];
  };

  person_level_keyword?: {
    sources?: Array<{ mode?: string; source?: string }>;
    content?: string[];
  };

  person_locations?: Array<{
    name?: string;
    countryCode?: string;
    stateCode?: string;
  }>;

  company_locations?: Array<{
    name?: string;
    countryCode?: string;
    stateCode?: string;
  }>;

  fields?: string[];

  // allow forward-compatible extra fields
  [key: string]: unknown;
}

export interface SearchLeadsCreateExportRequest {
  filter: SearchLeadsFilter;
  noOfLeads: number;
  fileName: string;
}

export interface SearchLeadsCreateExportResponse {
  message: string;
  log_id: string;
}

export type SearchLeadsJobStatus = "pending" | "completed" | "failed";

export interface SearchLeadsStatusCheckResponse {
  log?: {
    LogID: string;
    status: SearchLeadsJobStatus;
  };
}

export interface SearchLeadsResultResponse {
  log?: {
    LogID: string;
    status: SearchLeadsJobStatus;

    fileName?: string;
    leadsRequested?: number;
    leadsEnriched?: number;
    creditsUsed?: number;
    valid_email_count?: number;

    // When outputFileFormat=json => data: array of leads
    // Otherwise => data: url string
    data?: unknown;
  };
}

export interface SearchLeadsLeadRow {
  id?: string;

  first_name?: string;
  last_name?: string;
  name?: string;

  email?: string;
  personal_email?: string;
  email_status?: string;

  phone_number?: string;
  valid_mobile_number?: string;

  linkedin_url?: string;
  title?: string;
  seniority?: string;
  function?: string;

  organization_name?: string;
  organization_primary_domain?: string;
  organization_linkedin_url?: string;
  website_url?: string;

  city?: string | null;
  state?: string | null;
  country?: string | null;

  [key: string]: unknown;
}
