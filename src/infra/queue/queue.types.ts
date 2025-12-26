export const QUEUE_TYPES = {
  Redis: Symbol.for("Redis"),
  LeadSearchQueue: Symbol.for("LeadSearchQueue"),
} as const;
