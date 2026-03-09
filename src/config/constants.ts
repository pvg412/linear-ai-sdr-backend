// Centralized application constants

/**
 * Scraper-related constants
 */
export const SCRAPER_CONSTANTS = {
  // Grace period for external run ID (2 minutes)
  EXTERNAL_RUN_ID_GRACE_MS: 2 * 60 * 1000,
  // Retry delay for external run ID (15 seconds)
  EXTERNAL_RUN_ID_RETRY_DELAY_MS: 15 * 1000,
  // Maximum leads limit
  MAX_LEADS_LIMIT: 50_000,
  // Minimum leads limit
  MIN_LEADS_LIMIT: 1,
} as const;

/**
 * ScraperCity-specific constants
 */
export const SCRAPER_CITY_CONSTANTS = {
  // Polling interval (30 minutes)
  POLL_INTERVAL_MS: 30 * 60 * 1000,
  // Maximum poll attempts (180 * 30min = 90 hours)
  MAX_POLL_ATTEMPTS: 180,
  // Minimum scrape count
  MIN_SCRAPE_COUNT: 500,
  // Maximum scrape count
  MAX_SCRAPE_COUNT: 50_000,
} as const;

/**
 * Apify-specific constants
 */
export const APIFY_CONSTANTS = {
  // Polling interval (1 minute)
  POLL_INTERVAL_MS: 60 * 1000,
  // Maximum poll attempts (180 * 1min = 3 hours)
  MAX_POLL_ATTEMPTS: 180,
  // Maximum items with segmentation
  MAX_WITH_SEGMENTATION: 100_000,
  // Minimum delay for rate limit resume
  MIN_RATE_LIMIT_DELAY_MS: 1_000,
} as const;

/**
 * Chat-related constants
 */
export const CHAT_CONSTANTS = {
  // Maximum messages to include in AI context
  LIMIT_MESSAGES_FOR_AI: 15,
  // Delta flush interval for WebSocket streaming (50ms)
  DELTA_FLUSH_INTERVAL_MS: 50,
  // Delta flush threshold (64 characters)
  DELTA_FLUSH_THRESHOLD: 64,
} as const;

/**
 * HTTP client timeouts
 */
export const HTTP_TIMEOUTS = {
  DEFAULT_MS: 60_000,
  SHORT_MS: 30_000,
  LONG_MS: 120_000,
} as const;

/**
 * Polling configuration
 */
export const POLLING_CONSTANTS = {
  // Default polling interval
  DEFAULT_INTERVAL_MS: 5_000,
  // One minute in milliseconds
  ONE_MINUTE_MS: 60_000,
} as const;

/**
 * Lead search constants
 */
export const LEAD_SEARCH_CONSTANTS = {
  // Raw fallback preview character limit
  RAW_FALLBACK_PREVIEW_CHARS: 16_000,
  // Throttle interval for notifications
  THROTTLE_INTERVAL_MS: 30_000,
} as const;

/**
 * String truncation limits
 */
export const TRUNCATION_LIMITS = {
  AXIOS_ERROR_DATA: 2_000,
} as const;

/**
 * Lead scoring pipeline step constants
 */
export const SCORING_CONSTANTS = {
  /** Lead passes scoring if score >= this value (0-100 scale) */
  SCORING_THRESHOLD: 60,
  /** Number of leads processed in parallel per batch */
  BATCH_SIZE: 10,
} as const;

/**
 * Lead enrichment pipeline step constants
 *
 * Batch size is conservative because each lead triggers two sequential
 * fire-and-forget operations (profile enrichment + company research),
 * each involving 3-5 DB queries + a Redis enqueue.
 */
export const ENRICHMENT_CONSTANTS = {
  /** Leads processed in parallel per batch */
  BATCH_SIZE: 5,
  /** Interval between DB polls when waiting for enrichment completion (ms) */
  POLL_INTERVAL_MS: 10_000,
} as const;

/**
 * Final lead scoring pipeline step constants
 *
 * Final scoring combines ICP fit (from AI via gRPC) with signal strength
 * (also from AI) into a weighted composite score.
 */
export const FINAL_SCORING_CONSTANTS = {
  /** Number of leads processed in parallel per batch */
  BATCH_SIZE: 10,
  /** Weight of ICP fit in composite score (0-1) */
  ICP_FIT_WEIGHT: 0.7,
  /** Weight of signal strength in composite score (0-1) */
  SIGNAL_STRENGTH_WEIGHT: 0.3,
} as const;

/**
 * Outreach pipeline step constants
 *
 * Generates outreach messages for each lead via a two-step AI flow:
 *   1. ParseOutreachContext (unary gRPC) — AI determines channel, stage, tactic
 *   2. ChatStream (streaming gRPC)       — AI generates message variants
 *
 * Batch size is conservative because each lead triggers two sequential
 * gRPC calls (parse + stream), each consuming AI resources.
 */
export const OUTREACH_CONSTANTS = {
  /** Number of leads processed in parallel per batch */
  BATCH_SIZE: 5,
  /** Per-call timeout for the gRPC chatStream (ms) */
  STREAM_TIMEOUT_MS: 360_000,
} as const;
