// English comments by request

import type { NormalizedLead } from "@/capabilities/shared/leadValidate";

type EmailStatus = NormalizedLead["emailStatus"];

export function normalizeScraperCityEmailResult(result: unknown): EmailStatus {
  if (typeof result !== "string") return "UNKNOWN";
  const s = result.trim().toLowerCase();
  if (!s) return "UNKNOWN";

  // ScraperCity uses email_result values like: ok, invalid, unknown, catch_all
  switch (s) {
    case "ok":
      return "DELIVERABLE";
    case "invalid":
      return "UNDELIVERABLE";
    case "catch_all":
      return "CATCH_ALL";
    case "unknown":
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}
