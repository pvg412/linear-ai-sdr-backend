/* ------------------------------------------------------------------ */
/*  Company-name normalisation & word-boundary matching for Reddit      */
/*  signal attribution.                                                 */
/* ------------------------------------------------------------------ */

/**
 * Legal / organisational suffixes that add noise to keyword searches
 * and attribution matching.  Order matters: longer suffixes first so
 * "Pvt. Ltd." is stripped before "Ltd." alone.
 */
const LEGAL_SUFFIXES = [
  // Multi-word first
  "pvt. ltd.",
  "pvt ltd",
  "pty. ltd.",
  "pty ltd",
  // Single-word
  "incorporated",
  "private",
  "corporation",
  "limited",
  "holdings",
  "group",
  "inc.",
  "inc",
  "corp.",
  "corp",
  "llc.",
  "llc",
  "ltd.",
  "ltd",
  "l.l.c.",
  "l.l.c",
  "gmbh",
  "ag",
  "s.a.",
  "sa",
  "s.r.l.",
  "srl",
  "b.v.",
  "bv",
  "plc",
  "pvt.",
  "pvt",
  "pty.",
  "pty",
  "co.",
  "co",
] as const;

/**
 * Strips legal suffixes, trims whitespace/punctuation, and collapses
 * internal whitespace.  The result is suitable for both Apify keyword
 * search and post-text attribution matching.
 *
 * Examples:
 *   "Meta Platforms, Inc."  → "Meta Platforms"
 *   "  Acme Corp.  "        → "Acme"
 *   "AI Labs LLC"           → "AI Labs"
 */
export function normalizeCompanyName(raw: string): string {
  let name = raw.trim();

  // Strip trailing comma / period that some CRMs leave behind
  name = name.replace(/[,.]$/g, "").trim();

  // Repeatedly strip legal suffixes (handles compound forms like "Pvt. Ltd.")
  let changed = true;
  while (changed) {
    changed = false;
    const lower = name.toLowerCase();
    for (const suffix of LEGAL_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        // Only strip if it's a separate word and would leave a non-empty name
        const prefixLen = name.length - suffix.length;
        if (prefixLen === 0) continue; // Don't strip if it's the entire name
        const charBefore = name[prefixLen - 1];
        if (charBefore === " " || charBefore === ",") {
          name = name.slice(0, prefixLen).trim();
          name = name.replace(/[,.]$/g, "").trim();
          changed = true;
          break; // Restart suffix scan from the top (longer suffixes first)
        }
      }
    }
  }

  // Collapse internal whitespace
  name = name.replace(/\s+/g, " ");

  return name;
}

/** Minimum character length for a company name to be used in matching.
 *  Names shorter than this produce too many false-positive substring hits. */
export const MIN_MATCHABLE_NAME_LENGTH = 3;

/**
 * Returns `true` if `text` contains `companyName` as a whole-word match
 * (word-boundary on both sides).  Both values must be pre-lowercased.
 *
 * Handles company names that contain regex-special characters
 * (e.g. "C++", "Y Combinator (YC)").
 */
export function matchesCompanyName(
  textLower: string,
  companyNameLower: string,
): boolean {
  if (companyNameLower.length < MIN_MATCHABLE_NAME_LENGTH) return false;

  const escaped = escapeRegex(companyNameLower);
  const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
  return pattern.test(textLower);
}

/**
 * Returns `true` if `text` contains a link or mention of the company
 * domain (e.g. "example.com" found inside a URL or plain text).
 */
export function matchesDomain(
  textLower: string,
  domain: string | null | undefined,
): boolean {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  if (d.length < 4) return false; // e.g. "a.co" is too short / ambiguous
  return textLower.includes(d);
}

/* ------------------------------------------------------------------ */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
