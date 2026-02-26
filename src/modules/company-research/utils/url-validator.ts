import axios from "axios";
import type { LoggerLike } from "@/infra/observability";

const HEAD_TIMEOUT_MS = 5000;
const GET_FALLBACK_TIMEOUT_MS = 5000;
const MAX_CONCURRENT_CHECKS = 5;

/* ------------------------------------------------------------------ */
/*  URL normalisation helpers                                         */
/* ------------------------------------------------------------------ */

/**
 * Normalise a URL for comparison: lowercase host, strip www., trailing slash,
 * fragment, and force https.
 */
function normaliseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    u.hash = "";
    // remove trailing slash on pathname (but keep "/" for root)
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Extract hostname without "www." prefix.
 */
function extractDomain(raw: string): string | null {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Citation matching                                                  */
/* ------------------------------------------------------------------ */

/**
 * Try to find the best matching citation URL for a given sourceUrl.
 *
 * Strategy (first match wins):
 *   1. Exact normalised match
 *   2. One URL is a prefix of the other (handles trailing params / anchors)
 *   3. Same domain + path starts with the same first two segments
 */
export function resolveSourceUrl(
  sourceUrl: string,
  citations: string[],
): string | null {
  const normSource = normaliseUrl(sourceUrl);
  if (!normSource) return null;

  const sourceDomain = extractDomain(sourceUrl);

  // Pass 1 — exact normalised match
  for (const citation of citations) {
    const normCitation = normaliseUrl(citation);
    if (normCitation && normCitation === normSource) {
      return citation; // return original (non-normalised) citation
    }
  }

  // Pass 2 — one URL is a prefix of the other
  for (const citation of citations) {
    const normCitation = normaliseUrl(citation);
    if (!normCitation) continue;
    if (normCitation.startsWith(normSource) || normSource.startsWith(normCitation)) {
      return citation;
    }
  }

  // Pass 3 — same domain + shared path prefix (first 2 segments)
  if (sourceDomain) {
    const sourceSegments = pathSegments(sourceUrl);

    for (const citation of citations) {
      const citationDomain = extractDomain(citation);
      if (citationDomain !== sourceDomain) continue;

      const citationSegments = pathSegments(citation);
      const shared = countSharedPrefix(sourceSegments, citationSegments);
      if (shared >= 2 || (shared >= 1 && sourceSegments.length <= 2)) {
        return citation;
      }
    }
  }

  return null;
}

function pathSegments(raw: string): string[] {
  try {
    return new URL(raw).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function countSharedPrefix(a: string[], b: string[]): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) count++;
    else break;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  HTTP accessibility check                                           */
/* ------------------------------------------------------------------ */

/**
 * Check whether a URL is reachable and does not return 4xx/5xx.
 * Tries HEAD first; falls back to GET if HEAD is rejected (405 / ECONNREFUSED).
 */
export async function checkUrlAccessibility(url: string): Promise<boolean> {
  try {
    const resp = await axios.head(url, {
      timeout: HEAD_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true, // don't throw on any status
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LinkChecker/1.0; +https://example.com)",
      },
    });

    // HEAD succeeded — check status
    if (resp.status >= 200 && resp.status < 400) return true;

    // Some servers reject HEAD with 405 / 403 — fall back to GET
    if (resp.status === 405 || resp.status === 403) {
      return getCheck(url);
    }

    return false; // 4xx / 5xx
  } catch {
    // Network error on HEAD — try GET as fallback
    return getCheck(url);
  }
}

async function getCheck(url: string): Promise<boolean> {
  try {
    const resp = await axios.get(url, {
      timeout: GET_FALLBACK_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
      // Only fetch headers, abort body download
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LinkChecker/1.0; +https://example.com)",
      },
    });

    // Destroy stream immediately — we only need the status code
    const stream = resp.data as { destroy?: () => void } | null;
    if (stream && typeof stream.destroy === "function") {
      stream.destroy();
    }

    return resp.status >= 200 && resp.status < 400;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Orchestrator                                                       */
/* ------------------------------------------------------------------ */

export interface SearchResultItem {
  date: string | null;
  summary: string;
  sourceUrl: string;
  category: string;
}

export interface ValidationStats {
  totalItems: number;
  citationMatched: number;
  headCheckPassed: number;
  removed: number;
}

/**
 * Validate and resolve sourceUrls against Perplexity citations.
 *
 * 1. Try to match each item's sourceUrl to a citation (cheap, no HTTP).
 * 2. For unmatched items, run parallel HEAD checks (bounded concurrency).
 * 3. Drop items whose URL could not be verified.
 */
export async function validateSearchResults(
  items: SearchResultItem[],
  citations: string[],
  logger?: LoggerLike,
): Promise<{ items: SearchResultItem[]; stats: ValidationStats }> {
  const stats: ValidationStats = {
    totalItems: items.length,
    citationMatched: 0,
    headCheckPassed: 0,
    removed: 0,
  };

  if (items.length === 0) {
    return { items: [], stats };
  }

  // Phase 1 — citation resolution (synchronous, fast)
  const resolved: Array<{ item: SearchResultItem; verified: boolean }> = [];

  for (const item of items) {
    const citationUrl = resolveSourceUrl(item.sourceUrl, citations);
    if (citationUrl) {
      resolved.push({
        item: { ...item, sourceUrl: citationUrl },
        verified: true,
      });
      stats.citationMatched++;
    } else {
      resolved.push({ item, verified: false });
    }
  }

  // Phase 2 — HEAD checks for unverified items (bounded concurrency)
  const unverified = resolved.filter((r) => !r.verified);

  if (unverified.length > 0) {
    // Process in batches to limit concurrency
    for (let i = 0; i < unverified.length; i += MAX_CONCURRENT_CHECKS) {
      const batch = unverified.slice(i, i + MAX_CONCURRENT_CHECKS);
      const results = await Promise.allSettled(
        batch.map((entry) => checkUrlAccessibility(entry.item.sourceUrl)),
      );

      for (let j = 0; j < batch.length; j++) {
        const result = results[j];
        const accessible =
          result.status === "fulfilled" && result.value === true;

        if (accessible) {
          batch[j].verified = true;
          stats.headCheckPassed++;
        } else {
          logger?.debug?.(
            { sourceUrl: batch[j].item.sourceUrl },
            "URL failed accessibility check, removing item",
          );
        }
      }
    }
  }

  // Phase 3 — filter
  const validItems = resolved.filter((r) => r.verified).map((r) => r.item);
  stats.removed = stats.totalItems - validItems.length;

  return { items: validItems, stats };
}
