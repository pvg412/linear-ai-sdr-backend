/**
 * Billing constants — all amounts in USD cents.
 *
 * Cost column  = actual provider cost (our COGS).
 * Price column = what we charge the user (with margin).
 *
 * Update this file when pricing changes. Do NOT scatter numbers elsewhere.
 *
 * Sub-cent note: GPT-5-mini costs $0.00225 per prompt call. At 2.2× margin
 * that yields $0.00495 — below 1 cent, which cannot be represented in integer
 * cents. We round up to 1 cent (actual margin ≈ 4.4×).
 */
export const BILLING = {
  /**
   * Full pipeline execution (all 6 steps: lead-generation, scoring ×2,
   * enrichment, signals, outreach). Flat fee — covers everything inside.
   *
   * Cost: variable (~$40-60 in provider costs).
   * Price: $100.00 flat.
   */
  PIPELINE_RUN_CENTS: 10_000, // $100.00

  /**
   * Single AI prompt parse via gRPC (lead-search parse OR outreach parse).
   * Powered by GPT-5-mini; average token cost ≈ $0.00225.
   *
   * Cost: ~$0.00225.
   * Price: $0.01 (rounded up from $0.00495 due to integer-cent constraint).
   */
  PROMPT_PARSE_CENTS: 1, // $0.01

  /**
   * Single AI chat stream call via gRPC.
   * Covers: assistant.stream, outreach.prompt.apply, outreach.continue (per lead).
   * Powered by GPT-5-mini; same cost basis as PROMPT_PARSE_CENTS.
   *
   * Cost: ~$0.00225.
   * Price: $0.01.
   */
  AI_CHAT_STREAM_CENTS: 1, // $0.01

  /**
   * Per-lead charge for chat-initiated lead generation (NOT pipeline).
   * Pipeline lead generation is included in PIPELINE_RUN_CENTS.
   *
   * Cost: $0.02 / lead (provider API cost).
   * Price: $0.05 / lead (2.5× margin).
   */
  LEAD_GENERATION_PER_LEAD_CENTS: 5, // $0.05 per lead

  /**
   * Standalone company research request via Perplexity Sonar Pro API.
   * NOT charged when triggered inside the pipeline (covered by flat fee).
   *
   * Cost: ~$0.005-0.05 depending on context size.
   * Price: $0.05.
   */
  COMPANY_RESEARCH_CENTS: 5, // $0.05

  /**
   * Single profile enrichment request via Apify LinkedIn scraper.
   * NOT charged when triggered inside the pipeline (covered by flat fee).
   *
   * Cost: ~$0.01 (Apify actor compute unit cost).
   * Price: $0.02 (2.2× margin, rounded to nearest cent).
   */
  PROFILE_ENRICHMENT_CENTS: 2, // $0.02

  /**
   * Per-post charge for LinkedIn company posts fetched via Apify
   * (harvestapi/linkedin-profile-posts actor).
   * Only applies to standalone company research (NOT pipeline).
   * Charged after fetch — only for posts actually returned.
   *
   * Cost: $0.002 / post (Apify compute unit cost).
   * Price: $0.01 / post (2.2× margin → $0.0044, rounded up to nearest cent).
   */
  LINKEDIN_POSTS_PER_POST_CENTS: 1, // $0.01 per post
} as const;

// ── Derived helpers (read-only computed values) ──────────────────────────────

/** Format cents as a dollar string for display, e.g. centsToBillingDollars(50) => "$0.50" */
export function centsToBillingDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
