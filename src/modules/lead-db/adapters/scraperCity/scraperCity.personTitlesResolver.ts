import {
  SCRAPERCITY_ALLOWED_PERSON_TITLES,
  type ScraperCityAllowedPersonTitle,
} from "./scraperCity.allowedTitles";

type ResolveResult = {
  resolved: ScraperCityAllowedPersonTitle[];
  unmapped: string[];
  mapping: Record<string, ScraperCityAllowedPersonTitle>;
};

const STOP = new Set(["of", "and", "the", "to", "for", "in", "on", "at"]);

function normalizeKey(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    // make "&" comparable with "and"
    .replace(/&/g, " and ")
    // remove punctuation by turning into spaces
    .replace(/[()/,]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripParentheses(s: string): string {
  return String(s ?? "").replace(/\([^)]*\)/g, "").trim();
}

function tokens(s: string): string[] {
  return normalizeKey(s)
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((t) => !STOP.has(t));
}

function acronymFromTitle(title: string): string | null {
  const ts = tokens(title);
  if (ts.length < 2) return null;
  const a = ts.map((t) => t[0]).join("");
  return a.length >= 2 && a.length <= 6 ? a : null;
}

function looksLikeAcronym(input: string): string | null {
  // "CTO" -> "cto", "CEO" -> "ceo"
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const lettersOnly = raw.replace(/[^A-Za-z]/g, "");
  if (!lettersOnly) return null;

  if (lettersOnly.length >= 2 && lettersOnly.length <= 6 && lettersOnly === lettersOnly.toUpperCase()) {
    return lettersOnly.toLowerCase();
  }

  // also handle "cto" typed in lowercase
  if (lettersOnly.length >= 2 && lettersOnly.length <= 6 && lettersOnly === lettersOnly.toLowerCase()) {
    return lettersOnly.toLowerCase();
  }

  return null;
}

/**
 * Build indexes derived from allowlist (no manual dict).
 */
type AllowedEntry = {
  title: ScraperCityAllowedPersonTitle;
  key: string;
  keyNoParens: string;
  acronym: string | null;
};

const ALLOWED: AllowedEntry[] = SCRAPERCITY_ALLOWED_PERSON_TITLES.map((t) => {
  const key = normalizeKey(t);
  const keyNoParens = normalizeKey(stripParentheses(t));
  const acronym = acronymFromTitle(t);
  return { title: t, key, keyNoParens, acronym };
});

const EXACT = new Map<string, ScraperCityAllowedPersonTitle>();
const ACRONYM = new Map<string, ScraperCityAllowedPersonTitle[]>();

for (const e of ALLOWED) {
  if (e.key) EXACT.set(e.key, e.title);
  if (e.keyNoParens) EXACT.set(e.keyNoParens, e.title);

  if (e.acronym) {
    const list = ACRONYM.get(e.acronym) ?? [];
    list.push(e.title);
    ACRONYM.set(e.acronym, list);
  }
}

function pickBestAcronymCandidate(cands: ScraperCityAllowedPersonTitle[]): ScraperCityAllowedPersonTitle {
  // deterministic, avoids “(CTO)” variants when plain exists
  return [...cands].sort((a, b) => {
    const aHasParens = a.includes("(") ? 1 : 0;
    const bHasParens = b.includes("(") ? 1 : 0;
    if (aHasParens !== bHasParens) return aHasParens - bHasParens;

    // prefer shorter
    if (a.length !== b.length) return a.length - b.length;

    return a.localeCompare(b);
  })[0];
}

export function resolveScraperCityPersonTitles(
  inputs: string[] | undefined,
): ResolveResult {
  const resolved: ScraperCityAllowedPersonTitle[] = [];
  const unmapped: string[] = [];
  const mapping: Record<string, ScraperCityAllowedPersonTitle> = {};

  const seen = new Set<string>();

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { resolved, unmapped, mapping };
  }

  for (const raw of inputs) {
    const original = String(raw ?? "").trim();
    if (!original) continue;

    // 1) exact match by normalized key
    const k = normalizeKey(original);
    let hit = k ? EXACT.get(k) : undefined;

    // 2) try without parentheses in input
    if (!hit) {
      const k2 = normalizeKey(stripParentheses(original));
      hit = k2 ? EXACT.get(k2) : undefined;
    }

    // 3) acronym match (CTO, CEO, CFO...)
    if (!hit) {
      const acr = looksLikeAcronym(original);
      if (acr) {
        const cands = ACRONYM.get(acr);
        if (cands && cands.length > 0) {
          hit = pickBestAcronymCandidate(cands);
        }
      }
    }

    if (!hit) {
      unmapped.push(original);
      continue;
    }

    const hitKey = normalizeKey(hit);
    if (seen.has(hitKey)) continue;
    seen.add(hitKey);

    resolved.push(hit);
    mapping[original] = hit;
  }

  return { resolved, unmapped, mapping };
}
