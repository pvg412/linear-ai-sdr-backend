export const QUEUE_TYPES = {
  Redis: Symbol.for("Redis"),
  LeadSearchQueue: Symbol.for("LeadSearchQueue"),
  LeadRagIndexQueue: Symbol.for("LeadRagIndexQueue"),
  ProfileEnrichmentQueue: Symbol.for("ProfileEnrichmentQueue"),
} as const;
