export const LEAD_TYPES = {
	LeadRepository: Symbol.for("LeadRepository"),
	LeadQueryService: Symbol.for("LeadQueryService"),
	LeadCommandService: Symbol.for("LeadCommandService"),
} as const;
