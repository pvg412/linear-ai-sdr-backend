export const SCRAPERCITY_LIMITS = {
  /** Support: don't go beyond 100 requests per minute per API key */
  maxRequestsPerMinute: 100,

  /** Support: keep active parallel scrapes <= 10 */
  maxConcurrentTasks: 10,
} as const;

export const SCRAPERCITY_REDIS_KEYS = {
  activeTasks: "scrapercity:limits:activeTasks",
  requestsPerMinutePrefix: "scrapercity:limits:reqPerMin:",
} as const;

