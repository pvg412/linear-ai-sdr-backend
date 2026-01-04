export const LEAD_SEARCH_TYPES = {
  // repositories
  LeadSearchRepository: Symbol.for("LeadSearchRepository"),
  LeadSearchRunRepository: Symbol.for("LeadSearchRunRepository"),

  // services
  LeadSearchRunnerService: Symbol.for("LeadSearchRunnerService"),
  LeadSearchQueryService: Symbol.for("LeadSearchQueryService"),
  LeadSearchNotifierService: Symbol.for("LeadSearchNotifierService"),
  LeadSearchLeadPersisterService: Symbol.for("LeadSearchLeadPersisterService"),

  // handlers
  LeadDbLeadSearchHandler: Symbol.for("LeadDbLeadSearchHandler"),
  ScraperInlineLeadSearchHandler: Symbol.for("ScraperInlineLeadSearchHandler"),
  ScraperStepLeadSearchHandler: Symbol.for("ScraperStepLeadSearchHandler"),
} as const;
