// Stream event parsing utilities

import type { ChatStreamEvent } from "@/generated/aisdr/v1/ai_sdr";
import { isRecord } from "./chat-stream.types";

export function getEventPayload(ev: ChatStreamEvent): {
  kind: string;
  data?: Record<string, unknown>;
} {
  const u: unknown = ev;
  if (!isRecord(u)) return { kind: "unknown" };

  // oneof=unions => ev.payload?.$case
  const payload = u["payload"];
  if (isRecord(payload)) {
    const kase = payload["$case"];
    if (typeof kase === "string") {
      const dataUnknown = payload[kase];
      return isRecord(dataUnknown)
        ? { kind: kase, data: dataUnknown }
        : { kind: kase };
    }
  }

  // oneof=properties fallback
  for (const k of [
    "ack",
    "token",
    "retrieval",
    "final",
    "error",
    "heartbeat",
  ]) {
    const maybe = u[k];
    if (isRecord(maybe)) return { kind: k, data: maybe };
  }

  return { kind: "unknown" };
}
