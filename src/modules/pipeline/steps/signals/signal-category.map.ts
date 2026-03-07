import type { SignalCategory } from "@prisma/client";

/**
 * Internal mapping from provider-agnostic signal categories to the
 * signal "phase" identifiers used inside the signals step.
 *
 * This mapping is NEVER exposed to the company — they only interact
 * with category names (HIRING, FUNDING, COMMUNITY). The actual
 * providers behind each phase are resolved via DI multi-injection.
 *
 * Phase identifiers correspond to the provider groups in SignalsStep:
 *   - "hiring"     → hiringProviders   (e.g. Hirebase)
 *   - "crunchbase" → crunchbaseProviders (e.g. Crunchbase-Apify)
 *   - "reddit"     → redditProviders   (e.g. Reddit-Apify)
 */
export const SIGNAL_CATEGORY_PHASE_MAP: Record<SignalCategory, string> = {
  HIRING: "hiring",
  FUNDING: "crunchbase",
  COMMUNITY: "reddit",
} as const;

/** All signal categories the system recognises. */
export const ALL_SIGNAL_CATEGORIES: SignalCategory[] = ["HIRING", "FUNDING", "COMMUNITY"];

/**
 * Resolved category configuration used at runtime within the signals step.
 * If a company has not configured a category, defaults are applied:
 *   enabled = true, description = null.
 */
export interface ResolvedCategoryConfig {
  category: SignalCategory;
  enabled: boolean;
  description: string | null;
}
