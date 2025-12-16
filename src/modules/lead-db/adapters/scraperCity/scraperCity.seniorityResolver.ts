import {
  SCRAPERCITY_ALLOWED_SENIORITY_LEVELS,
  type ScraperCityAllowedSeniorityLevel,
} from "./scraperCity.allowedSeniority";

const key = (s: string): string =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const BY_KEY = new Map<string, ScraperCityAllowedSeniorityLevel>();

for (const v of SCRAPERCITY_ALLOWED_SENIORITY_LEVELS) {
  // "C-Suite" -> "c suite"
  BY_KEY.set(key(v), v);
}

export function resolveScraperCitySeniorityLevel(
  input: string | undefined,
): ScraperCityAllowedSeniorityLevel | undefined {
  if (!input) return undefined;

  const k = key(input);
  if (!k) return undefined;

  // --- Common synonyms that API does NOT accept directly ---
  if (k === "c level" || k === "clevel" || k === "clevel") return "C-Suite";
  if (k === "c suite" || k === "csuite") return "C-Suite";

  if (k === "entry level" || k === "entry") return "Entry"; // API wants "Entry"
  if (k === "vice president" || k === "vp") return "VP";

  // direct allowlist match (case-insensitive)
  const direct = BY_KEY.get(k);
  if (direct) return direct;

  return undefined;
}
