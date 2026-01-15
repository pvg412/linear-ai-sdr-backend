import { SEARCHLEADS_LIMITS } from "./searchleads.limits";
import type { SearchLeadsFilter } from "./searchleads.filterMapper";

function isStringArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.every((x) => typeof x === "string")
  );
}

/**
 * Support note: bulk lists (domains/linkedin) should be <= 100 items per request.
 * We can't know all SearchLeads filter keys, so we apply a best-effort split:
 * - Find the first key whose name contains "domain" or "linkedin" and value is string[] > 100
 * - Split it into chunks of 100, keeping other filter fields intact.
 */
export function splitSearchLeadsBulkFilter(
  filter: SearchLeadsFilter,
): { filters: SearchLeadsFilter[]; bulkKey?: string } {
  const entries = Object.entries(filter);

  const bulkEntry = entries.find(([k, v]) => {
    if (!/domain|linkedin/i.test(k)) return false;
    return isStringArray(v) && v.length > SEARCHLEADS_LIMITS.maxBulkItemsPerRequest;
  });

  if (!bulkEntry) return { filters: [filter] };

  const [bulkKey, bulkValue] = bulkEntry as [string, string[]];
  const out: SearchLeadsFilter[] = [];

  for (let i = 0; i < bulkValue.length; i += SEARCHLEADS_LIMITS.maxBulkItemsPerRequest) {
    const chunk = bulkValue.slice(i, i + SEARCHLEADS_LIMITS.maxBulkItemsPerRequest);
    out.push({
      ...filter,
      [bulkKey]: chunk,
    });
  }

  return { filters: out, bulkKey };
}
