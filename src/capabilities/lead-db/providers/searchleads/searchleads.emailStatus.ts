// English comments by request

import type { NormalizedLead } from "@/capabilities/shared/leadValidate";

type EmailStatus = NormalizedLead["emailStatus"];

export function normalizeSearchLeadsEmailStatus(status: unknown): EmailStatus {
  if (typeof status !== "string") return "UNKNOWN";
  const s = status.trim().toLowerCase();
  if (!s) return "UNKNOWN";

  switch (s) {
    case "deliverable":
      return "DELIVERABLE";
    case "undeliverable":
      return "UNDELIVERABLE";
    case "risky":
      return "RISKY";
    case "unknown":
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}
