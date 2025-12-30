export const LEAD_DIRECTORY_TYPES = {
  // repositories
  LeadDirectoryRepository: Symbol.for("LeadDirectoryRepository"),

  // CQRS
  LeadDirectoryCommandService: Symbol.for("LeadDirectoryCommandService"),
  LeadDirectoryQueryService: Symbol.for("LeadDirectoryQueryService"),
} as const;
