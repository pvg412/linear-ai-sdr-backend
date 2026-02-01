// Centralized type guards and utility functions

export type UnknownRecord = Record<string, unknown>;

/**
 * Type guard to check if a value is a non-null object (not an array).
 */
export function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Read a boolean value, returning undefined if not a boolean.
 */
export function readBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/**
 * Read a finite number value, returning undefined if not a valid number.
 */
export function readNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Read a string value, returning undefined if empty or not a string.
 */
export function readString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}
