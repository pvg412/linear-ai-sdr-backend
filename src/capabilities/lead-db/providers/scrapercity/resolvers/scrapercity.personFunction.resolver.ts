import {
  SCRAPERCITY_ALLOWED_PERSON_FUNCTIONS,
  type ScraperCityAllowedPersonFunction,
} from "../allowlists/scrapercity.allowedPersonFunctions";

type ResolveResult = {
  resolved: ScraperCityAllowedPersonFunction[];
  unmapped: string[];
  mapping: Record<string, ScraperCityAllowedPersonFunction>;
};

const key = (s: string): string =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const BY_KEY = new Map<string, ScraperCityAllowedPersonFunction>();

for (const v of SCRAPERCITY_ALLOWED_PERSON_FUNCTIONS) {
  BY_KEY.set(key(v), v);
}

function resolveOne(input: string): ScraperCityAllowedPersonFunction | undefined {
  const k = key(input);
  if (!k) return undefined;

  // --- Common synonyms that API does NOT accept directly ---
  // Your failing case:
  if (k === "technology" || k === "tech" || k === "it") {
    return "Information Technology";
  }

  // Useful extras (small & pragmatic)
  if (k === "information technology" || k === "info tech") {
    return "Information Technology";
  }

  if (
    k === "software engineering" ||
    k === "software development" ||
    k === "development" ||
    k === "dev"
  ) {
    return "Engineering";
  }

  if (k === "data" || k === "analytics") {
    return "Data Science";
  }

  if (k === "product") {
    return "Product Management";
  }

  if (k === "hr") {
    return "Human Resources";
  }

  if (k === "biz dev") {
    return "Business Development";
  }

  // direct allowlist match (case-insensitive)
  const direct = BY_KEY.get(k);
  if (direct) return direct;

  return undefined;
}

export function resolveScraperCityPersonFunctionIncludes(
  inputs: string[] | undefined,
): ResolveResult {
  const resolved: ScraperCityAllowedPersonFunction[] = [];
  const unmapped: string[] = [];
  const mapping: Record<string, ScraperCityAllowedPersonFunction> = {};

  const seen = new Set<string>();

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { resolved, unmapped, mapping };
  }

  for (const raw of inputs) {
    const original = String(raw ?? "").trim();
    if (!original) continue;

    const hit = resolveOne(original);
    if (!hit) {
      unmapped.push(original);
      continue;
    }

    const hitKey = key(hit);
    if (seen.has(hitKey)) continue;
    seen.add(hitKey);

    resolved.push(hit);
    mapping[original] = hit;
  }

  return { resolved, unmapped, mapping };
}
