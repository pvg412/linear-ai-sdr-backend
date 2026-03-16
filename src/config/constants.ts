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
 * RAG (Retrieval-Augmented Generation) indexing constants
 *
 * Signal data (hiring jobs, Reddit posts) is indexed as individual documents
 * per item to support precise semantic search. Documents are sent in batches
 * to avoid overwhelming the AI service with large single requests.
 */
export const RAG_CONSTANTS = {
  /**
   * Number of LeadDocuments sent per UpsertLeadDocuments gRPC call.
   * At ~300 chars/doc average, 50 docs ≈ 15 KB — well within the 50 MB limit.
   * Increase if AI service handles large batches efficiently.
   */
  SIGNAL_BATCH_SIZE: 50,
  /**
   * Maximum characters per document text before truncation.
   * ~4000 chars ≈ 1000-1500 tokens, fits comfortably in embedding model windows.
   */
  MAX_DOC_CHARS: 4_000,
} as const;
