/**
 * Pipeline configuration — single source of truth for all pipeline parameters.
 *
 * Edit this file to tune pipeline behaviour without touching step implementations
 * or the pipeline definition. All values are grouped by step/concern.
 *
 * Naming conventions:
 *   - *Ms      — duration in milliseconds
 *   - *Size    — number of items in a batch
 *   - *Limit   — upper-bound count
 *   - *Weight  — 0-1 fraction used in a weighted formula
 */
export const PIPELINE_CONFIG = {
  /* ------------------------------------------------------------------ */
  /*  Lead Generation step                                               */
  /* ------------------------------------------------------------------ */
  leadGeneration: {
    /**
     * Maximum number of leads to fetch and persist in one pipeline run.
     * Apify scraper is started with this limit and results are trimmed to it.
     */
    leadLimit: 50,

    /**
     * Job titles / roles to search for when generating leads.
     * Used to build the prompt sent to the AI gRPC parse endpoint.
     */
    roles: [
      "Founder",
      "Co-Founder",
      "CEO",
      "CTO",
      "Chief Technology Officer",
      "VP Engineering",
      "Head of Engineering",
      "Director of Engineering",
      "VP Product",
      "Head of Product",
      "CPO",
      "Chief Product Officer",
      "Head of Innovation",
      "Innovation Director",
      "Head of Blockchain",
      "Head of Digital Assets",
    ] as const,

    /** How long to wait between Apify actor status polls (ms). */
    pollIntervalMs: 30_000,

    /** Maximum number of Apify poll attempts before timing out. */
    maxPollAttempts: 30, // 30 × 30 s = 15 min max

    /** Step-level execution timeout (ms). */
    timeoutMs: 15 * 60 * 1_000, // 15 min
  },

  /* ------------------------------------------------------------------ */
  /*  Scoring step (initial)                                             */
  /* ------------------------------------------------------------------ */
  scoring: {
    /**
     * Minimum AI score (0-100) a lead must achieve to pass initial scoring.
     * Leads below this threshold are marked excluded and skipped in later steps.
     */
    threshold: 60,

    /** Number of leads scored in parallel per batch. */
    batchSize: 10,
  },

  /* ------------------------------------------------------------------ */
  /*  Enrichment step                                                    */
  /* ------------------------------------------------------------------ */
  enrichment: {
    /**
     * Whether to run LinkedIn profile scraping via Apify for each lead.
     * Set to false to skip Apify enrichment calls entirely.
     */
    includeProfileEnrichment: true,

    /**
     * Number of leads for which enrichment is fired in parallel per batch.
     * Conservative because each lead triggers DB queries + a Redis enqueue.
     */
    batchSize: 5,

    /** Interval between DB polls when waiting for enrichment completion (ms). */
    pollIntervalMs: 10_000,

    /** Step-level execution timeout (ms). */
    timeoutMs: 10 * 60 * 1_000, // 10 min
  },

  /* ------------------------------------------------------------------ */
  /*  Signals step                                                       */
  /* ------------------------------------------------------------------ */
  signals: {
    /**
     * Master toggle for Perplexity AI news + LinkedIn posts company research.
     * When false, the entire company-research phase is skipped.
     */
    includeCompanyResearch: true,

    /**
     * Sub-toggle for fetching LinkedIn company posts via Apify.
     * Only takes effect when includeCompanyResearch is also true.
     */
    includeLinkedinPosts: true,

    /**
     * Maximum character length of a single LinkedIn post's content text.
     * The raw post body is truncated to this length before being stored in
     * the DB and indexed in RAG (ChromaDB). Since AI retrieval uses RAG,
     * longer values improve scoring and outreach personalisation quality.
     *
     * Note: engagement metadata (likes, comments, shares) and document
     * title prefix are appended AFTER this truncation, so the final stored
     * string may be slightly longer.
     */
    linkedinPostContentMaxChars: 2000,

    /**
     * Recency window for Perplexity company news search and LinkedIn posts.
     * Passed directly to the Perplexity API and the LinkedIn Apify actor.
     */
    perplexityRecency: "month" as "day" | "week" | "month" | "year",

    /**
     * Maximum number of Perplexity search results AND LinkedIn posts
     * fetched per company. Increase to get more signal data (higher cost).
     */
    perplexityMaxResults: 100,

    /**
     * Max companies processed in parallel during the company-research phase
     * (Perplexity + Apify calls). Keep low — both providers are slow.
     */
    companyConcurrency: 3,

    /**
     * Max companies processed in parallel during the hiring-signals phase.
     * Higher than companyConcurrency because hiring APIs are faster.
     */
    hiringConcurrency: 5,

    /**
     * Number of companies batched together per Reddit signals API call.
     */
    redditBatchSize: 10,

    /**
     * Maximum number of Reddit posts/comments fetched per subreddit search.
     * Each subreddit search counts as one Apify actor call.
     * Increase for more signal coverage (higher Apify cost and runtime).
     */
    redditMaxPostsPerSubreddit: 25,

    /**
     * Maximum total Reddit posts retained per company across all subreddits.
     * Posts beyond this limit are discarded after combining subreddit results.
     */
    redditMaxPostsPerCompany: 50,

    /**
     * Number of companies processed in parallel during the Crunchbase phase
     * (each company = one Apify actor call). Keep low to avoid rate limits.
     */
    crunchbaseConcurrency: 3,

    /**
     * Maximum number of competitor names extracted from Crunchbase
     * org_similarity_list (sorted by similarity score, highest first).
     */
    crunchbaseMaxCompetitors: 5,

    /**
     * Maximum number of technology names extracted from Crunchbase
     * builtwith_tech_used_list (first N entries).
     */
    crunchbaseMaxTechItems: 15,

    /** Step-level execution timeout (ms). */
    timeoutMs: 30 * 60 * 1_000, // 30 min
  },

  /* ------------------------------------------------------------------ */
  /*  Final Scoring step                                                 */
  /* ------------------------------------------------------------------ */
  finalScoring: {
    /** Number of leads scored in parallel per batch. */
    batchSize: 10,

    /**
     * Weight of ICP fit score in the final composite score.
     * Must satisfy: icpFitWeight + signalStrengthWeight === 1.
     */
    icpFitWeight: 0.7,

    /**
     * Weight of signal strength score in the final composite score.
     * Must satisfy: icpFitWeight + signalStrengthWeight === 1.
     */
    signalStrengthWeight: 0.3,
  },

  /* ------------------------------------------------------------------ */
  /*  Outreach step                                                      */
  /* ------------------------------------------------------------------ */
  outreach: {
    /**
     * Default outreach channel used when generating messages.
     * Passed to the AI gRPC ParseOutreachContext call.
     */
    channel: "linkedin" as "linkedin" | "email",

    /**
     * Number of leads for which outreach is generated in parallel per batch.
     * Conservative because each lead triggers two sequential gRPC calls.
     */
    batchSize: 5,

    /** Per-call timeout for the gRPC chatStream request (ms). */
    streamTimeoutMs: 360_000,

    /** Step-level execution timeout (ms). */
    timeoutMs: 15 * 60 * 1_000, // 15 min
  },

  /* ------------------------------------------------------------------ */
  /*  Pipeline execution defaults                                        */
  /* ------------------------------------------------------------------ */
  execution: {
    /**
     * Default error policy applied to all steps unless overridden per-step.
     * "stop"     — abort the pipeline on first step failure.
     * "continue" — log the failure and proceed to the next step.
     */
    defaultOnError: "stop" as "stop" | "continue",

    /** Default per-step timeout used when a step does not define its own (ms). */
    defaultTimeoutMs: 5 * 60 * 1_000, // 5 min

    /** Total number of attempts for each step (1 = no retries). */
    retryMaxAttempts: 2,

    /** Base backoff delay between retry attempts (ms). */
    retryBackoffMs: 3_000,

    /** Backoff strategy: fixed delay or exponentially increasing. */
    retryBackoffType: "exponential" as "fixed" | "exponential",
  },
} as const;
