export const COMPANY_RESEARCH_TYPES = {
  // Services
  CompanyResearchQueryService: Symbol.for("CompanyResearchQueryService"),
  CompanyResearchCommandService: Symbol.for("CompanyResearchCommandService"),
  CompanyResearchRunnerService: Symbol.for("CompanyResearchRunnerService"),
  CompanyResearchRepository: Symbol.for("CompanyResearchRepository"),
  PerplexityClient: Symbol.for("PerplexityClient"),
  LinkedinPostsApifyClient: Symbol.for("LinkedinPostsApifyClient"),
} as const;
