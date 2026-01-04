export const QUEUE_TYPES = {
  Redis: Symbol.for("Redis"),
  LeadSearchQueue: Symbol.for("LeadSearchQueue"),
  LeadRagIndexQueue: Symbol.for("LeadRagIndexQueue"),
} as const;
