import {
  SCRAPERCITY_ALLOWED_COMPANY_INDUSTRIES,
  type ScraperCityAllowedCompanyIndustry,
} from "../allowlists/scrapercity.allowedIndustries";

const normalizeKey = (s: string): string =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    // make "&" comparable with "and"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitIndustryInput = (input: string | undefined): string[] => {
  const raw = String(input ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[,/|;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
};

const BY_KEY = new Map<string, ScraperCityAllowedCompanyIndustry>();

for (const ind of SCRAPERCITY_ALLOWED_COMPANY_INDUSTRIES) {
  BY_KEY.set(normalizeKey(ind), ind);
}

export function resolveScraperCityCompanyIndustry(
  input: string | undefined,
): ScraperCityAllowedCompanyIndustry | undefined {
  const parts = splitIndustryInput(input);
  if (parts.length === 0) return undefined;

  // Prefer exact match for full string
  const fullKey = normalizeKey(input ?? "");
  const full = fullKey ? BY_KEY.get(fullKey) : undefined;
  if (full) return full;

  // Otherwise try parts (e.g. "Web3, Internet" -> "Internet")
  for (const p of parts) {
    const k = normalizeKey(p);
    if (!k) continue;
    const v = BY_KEY.get(k);
    if (v) return v;
  }

  return undefined;
}

/**
 * If user passes "web3", "crypto", "blockchain", etc — it's not an allowed industry,
 * treat it as keywords.
 */
export function shouldMoveIndustryToKeywords(industry: string | undefined): boolean {
  const s = normalizeKey(industry ?? "");
  if (!s) return false;

  // ScraperCity industries are strict LinkedIn taxonomy; tech buzzwords should be keywords.
  return (
    s.includes("web3") ||
    s.includes("crypto") ||
    s.includes("blockchain") ||
    s.includes("artificial intelligence") ||
    s.includes("machine learning") ||
    s === "ai"
  );
}

export function mergeKeywords(
  existing: string[] | undefined,
  additions: string[] | undefined,
): string[] | undefined {
  const set = new Set<string>();

  for (const x of existing ?? []) {
    const v = String(x ?? "").trim().toLowerCase();
    if (v) set.add(v);
  }
  for (const x of additions ?? []) {
    const v = String(x ?? "").trim().toLowerCase();
    if (v) set.add(v);
  }

  const res = Array.from(set);
  return res.length ? res : undefined;
}

export function industryToKeywordTokens(industry: string | undefined): string[] {
  const parts = splitIndustryInput(industry);
  if (parts.length > 0) return parts;
  const v = String(industry ?? "").trim();
  return v ? [v] : [];
}
