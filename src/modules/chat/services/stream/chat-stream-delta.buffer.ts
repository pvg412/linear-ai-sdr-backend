// Delta buffering for WebSocket streaming

import { CHAT_CONSTANTS } from "@/config/constants";

export interface DeltaBuffer {
  pending: string;
  lastFlushAt: number;
}

export function createDeltaBuffer(): DeltaBuffer {
  return {
    pending: "",
    lastFlushAt: Date.now(),
  };
}

export function appendDelta(buffer: DeltaBuffer, delta: string): void {
  buffer.pending += delta;
}

export function shouldFlush(buffer: DeltaBuffer): boolean {
  if (!buffer.pending) return false;

  const now = Date.now();
  return (
    buffer.pending.length >= CHAT_CONSTANTS.DELTA_FLUSH_THRESHOLD ||
    now - buffer.lastFlushAt >= CHAT_CONSTANTS.DELTA_FLUSH_INTERVAL_MS
  );
}

export function flushBuffer(buffer: DeltaBuffer): string {
  const delta = buffer.pending;
  buffer.pending = "";
  buffer.lastFlushAt = Date.now();
  return delta;
}
