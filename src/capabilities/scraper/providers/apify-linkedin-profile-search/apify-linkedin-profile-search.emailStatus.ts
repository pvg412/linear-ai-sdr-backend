// English comments by request

import type { NormalizedLead } from "@/capabilities/shared/leadValidate";

type EmailStatus = NormalizedLead["emailStatus"];

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function readNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function readString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function normalizeLegacyStatus(result: unknown): EmailStatus {
  const s = readString(result)?.toLowerCase();
  if (!s) return "UNKNOWN";

  switch (s) {
    // Common providers
    case "deliverable":
    case "ok":
    case "valid":
      return "DELIVERABLE";
    case "undeliverable":
    case "invalid":
      return "UNDELIVERABLE";
    case "catch_all":
    case "catch-all":
    case "accept_all":
    case "accept-all":
    case "acceptall":
      return "CATCH_ALL";
    case "risky":
      return "RISKY";
    case "unknown":
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

type ApifyEmailEntry = {
  email?: string;
  status?: string;
  deliverable?: boolean;
  catchAllDomain?: boolean;
  validEmailServer?: boolean;
  qualityScore?: number;
};

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

export function normalizeApifyEmailStatus(input: {
  selectedEmail: string | undefined;
  emails?: unknown;
  contactEmails?: unknown;
  legacyEmailResult?: unknown;
}): EmailStatus {
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
    return normalizeLegacyStatus(input.legacyEmailResult);
  }

  return "UNKNOWN";
}
