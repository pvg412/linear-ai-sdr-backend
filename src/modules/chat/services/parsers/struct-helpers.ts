// google.protobuf.Struct -> plain JSON helpers
// Supports common ts-proto shapes.

import { isRecord } from "./parser.types";

export function valueToJson(v: unknown): unknown {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return v;
  if (!isRecord(v)) return undefined;

  // ts-proto can encode oneof either as:
  // 1) { kind: { $case: "stringValue", stringValue: "x" } }
  // 2) { $case: "stringValue", stringValue: "x" }
  const kind = v["kind"];
  const union = isRecord(kind) && typeof kind["$case"] === "string" ? kind : v;
  const kase = union["$case"];

  if (typeof kase === "string") {
    switch (kase) {
      case "nullValue":
        return null;
      case "stringValue":
        return typeof union["stringValue"] === "string"
          ? union["stringValue"]
          : undefined;
      case "numberValue":
        return typeof union["numberValue"] === "number"
          ? union["numberValue"]
          : undefined;
      case "boolValue":
        return typeof union["boolValue"] === "boolean"
          ? union["boolValue"]
          : undefined;
      case "structValue":
        return structToJson(union["structValue"]) ?? {};
      case "listValue":
        return listValueToJson(union["listValue"]);
      default:
        return undefined;
    }
  }

  // some generators expose direct fields without $case
  if (typeof v["stringValue"] === "string") return v["stringValue"];
  if (typeof v["numberValue"] === "number") return v["numberValue"];
  if (typeof v["boolValue"] === "boolean") return v["boolValue"];
  if ("nullValue" in v) return null;

  if (v["structValue"]) return structToJson(v["structValue"]) ?? {};
  if (v["listValue"]) return listValueToJson(v["listValue"]);

  return undefined;
}

export function listValueToJson(lv: unknown): unknown[] {
  if (!isRecord(lv)) return [];
  const values = lv["values"];
  if (!Array.isArray(values)) return [];
  const out: unknown[] = [];
  for (const item of values) {
    const j = valueToJson(item);
    if (j !== undefined) out.push(j);
  }
  return out;
}

export function structToJson(
  st: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(st)) return undefined;

  // ts-proto Struct: { fields: { [k]: Value } }
  const fields = st["fields"];
  if (isRecord(fields)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      const j = valueToJson(v);
      if (j !== undefined) out[k] = j;
    }
    return out;
  }

  // fallback: if generator already gave a plain object
  // (we avoid copying proto metadata keys)
  const out: Record<string, unknown> = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(st)) {
    if (k === "$type") continue;
    if (k === "fields") continue;
    out[k] = v;
    hasAny = true;
  }
  return hasAny ? out : undefined;
}
