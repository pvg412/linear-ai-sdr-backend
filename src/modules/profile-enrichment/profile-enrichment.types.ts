export const PROFILE_ENRICHMENT_TYPES = {
  ProfileEnrichmentRepository: Symbol.for("ProfileEnrichmentRepository"),
  ProfileEnrichmentApifyClient: Symbol.for("ProfileEnrichmentApifyClient"),
  ProfileEnrichmentCommandService: Symbol.for("ProfileEnrichmentCommandService"),
  ProfileEnrichmentQueryService: Symbol.for("ProfileEnrichmentQueryService"),
  ProfileEnrichmentRunnerService: Symbol.for("ProfileEnrichmentRunnerService"),
} as const;
