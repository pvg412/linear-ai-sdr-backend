// Centralized email status normalization logic

import type {
  EmailStatus,
  RawEmailStatus,
  ApifyEmailEntry,
  ApifyEmailStatusInput,
} from "./emailStatus.types";
import {
  isRecord,
  readBool,
  readNumber,
  readString,
} from "@/capabilities/shared/typeGuards";

/**
 * Normalize a simple string-based email status.
 * Used by ScraperCity, SearchLeads, and legacy formats.
 */
export function normalizeSimpleEmailStatus(result: RawEmailStatus): EmailStatus {
  if (typeof result !== "string") return "UNKNOWN";
  const s = result.trim().toLowerCase();
  if (!s) return "UNKNOWN";

  switch (s) {
    // Deliverable variants
    case "deliverable":
    case "ok":
    case "valid":
      return "DELIVERABLE";

    // Undeliverable variants
    case "undeliverable":
    case "invalid":
      return "UNDELIVERABLE";

    // Catch-all variants
    case "catch_all":
    case "catch-all":
    case "accept_all":
    case "accept-all":
    case "acceptall":
      return "CATCH_ALL";

    // Risky
    case "risky":
      return "RISKY";

    // Unknown
    case "unknown":
    default:
      return "UNKNOWN";
  }
}

// Apify-specific parsing logic
function parseApifyEmailEntry(v: unknown): ApifyEmailEntry | null {
  if (!isRecord(v)) return null;

  const email = readString(v.email);
  const status = readString(v.status);
  const deliverable = readBool(v.deliverable);
  const catchAllDomain = readBool(v.catchAllDomain);
  const validEmailServer = readBool(v.validEmailServer);
  const qualityScore = readNumber(v.qualityScore);

  // If it doesn't look like an email entry at all, ignore it.
  if (
    !email &&
    !status &&
    deliverable === undefined &&
    catchAllDomain === undefined &&
    validEmailServer === undefined &&
    qualityScore === undefined
  ) {
    return null;
  }

  return {
    email,
    status,
    deliverable,
    catchAllDomain,
    validEmailServer,
    qualityScore,
  };
}

function pickApifyEmailEntryByEmail(
  selectedEmail: string,
  ...sources: unknown[]
): ApifyEmailEntry | null {
  const target = selectedEmail.trim().toLowerCase();
  if (!target) return null;

  for (const src of sources) {
    if (!Array.isArray(src)) continue;
    for (const item of src) {
      const entry = parseApifyEmailEntry(item);
      if (!entry?.email) continue;
      if (entry.email.trim().toLowerCase() === target) return entry;
    }
  }
  return null;
}

function normalizeApifyEmailEntry(entry: ApifyEmailEntry): EmailStatus {
  const status = entry.status?.trim().toLowerCase();
  if (status) {
    if (status.includes("catch") || status.includes("accept"))
      return "CATCH_ALL";
    if (status.includes("risk")) return "RISKY";
    if (status.includes("invalid") || status.includes("undeliver"))
      return "UNDELIVERABLE";
    if (status.includes("valid") || status.includes("deliver"))
      return "DELIVERABLE";
    if (status.includes("unknown")) return "UNKNOWN";
  }

  // Fallback to flags when status is absent/unrecognized.
  if (entry.catchAllDomain === true) return "CATCH_ALL";
  if (entry.deliverable === true) return "DELIVERABLE";
  if (entry.deliverable === false) return "UNDELIVERABLE";

  // "validEmailServer" means MX exists, but deliverability is uncertain.
  if (entry.validEmailServer === true) return "RISKY";
  return "UNKNOWN";
}

/**
 * Normalize Apify email status from complex nested structures.
 * Handles emails array, contactEmails, and legacy emailResult fields.
 */
export function normalizeApifyEmailStatus(
  input: ApifyEmailStatusInput,
): EmailStatus {
  const selected = readString(input.selectedEmail);
  if (!selected) return "UNKNOWN";

  const entry = pickApifyEmailEntryByEmail(
    selected,
    input.emails,
    input.contactEmails,
  );
  if (entry) return normalizeApifyEmailEntry(entry);

  // Back-compat: some datasets might still include email_result/emailResult strings.
  if (input.legacyEmailResult !== undefined) {
    return normalizeSimpleEmailStatus(input.legacyEmailResult as string);
  }

  return "UNKNOWN";
}

// Provider-specific aliases for backward compatibility
export const normalizeScraperCityEmailResult = normalizeSimpleEmailStatus;
export const normalizeSearchLeadsEmailStatus = normalizeSimpleEmailStatus;
