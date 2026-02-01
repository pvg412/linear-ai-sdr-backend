// Centralized email status types

import type { NormalizedLead } from "@/capabilities/shared/leadValidate";

export type EmailStatus = NormalizedLead["emailStatus"];

// Raw email status strings from different providers
export type RawEmailStatus = string | undefined | null;

// Apify-specific email entry structure
export interface ApifyEmailEntry {
  email?: string;
  status?: string;
  deliverable?: boolean;
  catchAllDomain?: boolean;
  validEmailServer?: boolean;
  qualityScore?: number;
}

// Input for Apify email status normalization
export interface ApifyEmailStatusInput {
  selectedEmail: string | undefined;
  emails?: unknown;
  contactEmails?: unknown;
  legacyEmailResult?: unknown;
}
