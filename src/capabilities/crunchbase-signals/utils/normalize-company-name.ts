/**
 * Multi-level Crunchbase slug resolution utilities.
 *
 * The core problem: a company in the CRM may be called "GigRadar.io",
 * "GigRadar LLC", or "Gig Radar Inc." while Crunchbase uses "gigradar-io".
 * These utilities generate ordered candidate slugs so the provider can
 * try them against Crunchbase URLs.
 */

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Legal suffixes stripped during normalisation (case-insensitive). */
const LEGAL_SUFFIXES = [
  "incorporated",
  "corporation",
  "limited",
  "company",
  "llc",
  "inc",
  "ltd",
  "corp",
  "co",
  "gmbh",
  "sas",
  "sarl",
  "bv",
  "ag",
  "sa",
  "plc",
  "pty",
  "pvt",
  "lp",
  "llp",
  "pllc",
  "pc",
];

/** Domain-style TLD suffixes that may appear in a company name. */
const DOMAIN_SUFFIXES = [".io", ".ai", ".co", ".app", ".dev", ".xyz", ".tech", ".cloud", ".so"];

/** Common tech suffixes to try when generating variations. */
const TECH_SLUG_SUFFIXES = ["-io", "-ai"];

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Extracts a Crunchbase slug candidate from a website domain.
 *
 * @example
 *   extractSlugFromDomain("evacodes.com")     → "evacodes"
 *   extractSlugFromDomain("https://gig-radar.io") → "gig-radar"
 *   extractSlugFromDomain(null)               → null
 */
export function extractSlugFromDomain(
  domainOrUrl: string | null | undefined,
): string | null {
  if (!domainOrUrl) return null;

  let domain = domainOrUrl.trim().toLowerCase();

  // Strip protocol
  domain = domain.replace(/^https?:\/\//, "");
  // Strip www.
  domain = domain.replace(/^www\./, "");
  // Strip path and query
  domain = domain.replace(/[/?#].*$/, "");
  // Strip port
  domain = domain.replace(/:\d+$/, "");

  // Extract the part before the TLD
  const dotIdx = domain.indexOf(".");
  if (dotIdx <= 0) return null;

  const slug = domain.slice(0, dotIdx);
  if (!slug || slug.length < 2) return null;

  return slug;
}

/**
 * Normalises a company name into a Crunchbase-compatible kebab-case slug.
 *
 * Steps:
 * 1. Remove legal suffixes (LLC, Inc, Ltd, Corp, Co, GmbH, etc.)
 * 2. Remove domain-style suffixes (.io, .ai, .co, etc.)
 * 3. Split on camelCase boundaries, spaces, punctuation
 * 4. Convert to kebab-case
 *
 * @example
 *   normalizeCompanyName("Acme Corp Inc.") → "acme-corp"
 *   normalizeCompanyName("GigRadar.io")    → "gigradar"
 *   normalizeCompanyName("OpenAI")         → "openai"
 */
export function normalizeCompanyName(name: string): string {
  let cleaned = name.trim();

  // Remove domain-style suffixes (e.g. ".io", ".ai")
  for (const suffix of DOMAIN_SUFFIXES) {
    if (cleaned.toLowerCase().endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length);
      break; // Only strip one suffix
    }
  }

  // Remove legal suffixes — match at word boundary or after punctuation
  // Process from longest to shortest to avoid partial matches
  const sortedLegal = [...LEGAL_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of sortedLegal) {
    const pattern = new RegExp(
      `[\\s,._-]*\\b${suffix}\\b\\.?$`,
      "i",
    );
    cleaned = cleaned.replace(pattern, "");
  }

  cleaned = cleaned.trim();
  if (!cleaned) return "";

  // Split on non-alphanumeric characters
  const words = cleaned
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  // Join and lowercase
  const slug = words.join("-").toLowerCase();

  // Collapse multiple hyphens and trim
  return slug.replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

/**
 * Splits a camelCase or PascalCase name into separate words.
 *
 * @example
 *   splitCamelCase("GigRadar")  → ["Gig", "Radar"]
 *   splitCamelCase("openAI")    → ["open", "AI"]
 *   splitCamelCase("ABCTech")   → ["ABC", "Tech"]
 */
export function splitCamelCase(name: string): string[] {
  // Insert separator before uppercase letter preceded by lowercase
  // or before a single uppercase followed by lowercase (in a run of uppercase)
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Generates an ordered list of unique Crunchbase slug candidates.
 *
 * Level 1 — Domain-based (most reliable)
 * Level 2 — Normalised company name
 * Level 3 — Variations (with domain suffixes, camelCase split, first word)
 *
 * @returns Array of unique slug strings, ordered by confidence (best first).
 */
export function generateCandidateSlugs(input: {
  companyName: string;
  companyDomain?: string | null;
}): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (slug: string | null): void => {
    if (!slug || slug.length < 2) return;
    const normalised = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
    if (!normalised || normalised.length < 2 || seen.has(normalised)) return;
    seen.add(normalised);
    candidates.push(normalised);
  };

  // ── Level 1: Domain-based (most reliable) ──────────────────────
  const domainSlug = extractSlugFromDomain(input.companyDomain);
  addCandidate(domainSlug);

  // ── Level 2: Normalised company name ───────────────────────────
  const normalisedSlug = normalizeCompanyName(input.companyName);
  addCandidate(normalisedSlug);

  // ── Level 3: Variations ────────────────────────────────────────

  // 3a. Domain slug with common tech suffixes
  if (domainSlug) {
    for (const suffix of TECH_SLUG_SUFFIXES) {
      addCandidate(domainSlug + suffix);
    }
  }

  // 3b. camelCase split into kebab-case
  const camelWords = splitCamelCase(input.companyName.replace(/[^a-zA-Z0-9]/g, ""));
  if (camelWords.length > 1) {
    const camelSlug = camelWords.join("-").toLowerCase();
    addCandidate(camelSlug);

    // camelCase split + tech suffixes
    for (const suffix of TECH_SLUG_SUFFIXES) {
      addCandidate(camelSlug + suffix);
    }
  }

  // 3c. Normalised name with tech suffixes
  if (normalisedSlug) {
    for (const suffix of TECH_SLUG_SUFFIXES) {
      addCandidate(normalisedSlug + suffix);
    }
  }

  // 3d. First significant word only (if multi-word)
  const nameWords = normalisedSlug.split("-");
  if (nameWords.length > 1 && nameWords[0].length >= 3) {
    addCandidate(nameWords[0]);
  }

  return candidates;
}
