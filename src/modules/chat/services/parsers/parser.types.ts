// Shared types for prompt parser service

export type ExtractedQuery =
  | { kind: "leadDb"; value: Record<string, unknown> }
  | { kind: "scraper"; value: Record<string, unknown> };

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function readNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

export function readStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

export function readOptionalBool(
  obj: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = obj[key];
  if (typeof v === "boolean") return v;
  return undefined;
}

export function readOptionalEnumNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}
