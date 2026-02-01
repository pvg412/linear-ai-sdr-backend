// Centralized email status normalization module

export type {
  EmailStatus,
  RawEmailStatus,
  ApifyEmailEntry,
  ApifyEmailStatusInput,
} from "./emailStatus.types";

export {
  normalizeSimpleEmailStatus,
  normalizeApifyEmailStatus,
  // Backward-compatible aliases
  normalizeScraperCityEmailResult,
  normalizeSearchLeadsEmailStatus,
} from "./emailStatus.normalizer";
