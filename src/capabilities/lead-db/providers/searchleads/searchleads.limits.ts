export const SEARCHLEADS_LIMITS = {
  /** Support: don't go beyond 30 requests per minute */
  maxRequestsPerMinute: 30,

  /** Support: bulk lists (domains/linkedin/etc) must be <= 100 items per request */
  maxBulkItemsPerRequest: 100,

  /** Support: keep active parallel tasks <= 50 */
  maxConcurrentTasks: 50,
} as const;

export const SEARCHLEADS_REDIS_KEYS = {
  activeTasks: "searchleads:limits:activeTasks",
  requestsPerMinutePrefix: "searchleads:limits:reqPerMin:",
} as const;
