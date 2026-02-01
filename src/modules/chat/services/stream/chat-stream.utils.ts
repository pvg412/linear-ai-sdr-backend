// Utility functions for chat stream

import * as grpc from "@grpc/grpc-js";
import type { ResolveMentionsResult } from "@/modules/lead-directory/services/lead-directory-mention-resolver.service";

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;

  if (err && typeof err === "object") {
    const code = (err as { code?: number }).code;
    // grpc.status is a numeric enum; coerce to number to keep TS happy when comparing to a number.
    if (typeof code === "number" && code === Number(grpc.status.CANCELLED)) {
      return true;
    }
  }

  return err instanceof Error && err.name === "AbortError";
}

export function formatMentionError(res: ResolveMentionsResult): {
  code: string;
  message: string;
} {
  if (res.ambiguous.length > 0) {
    return {
      code: "CHAT_DIRECTORY_MENTION_AMBIGUOUS",
      message: `Ambiguous folder mention(s): ${res.ambiguous
        .map((m) => `@${m}`)
        .join(", ")}. Rename folders or mention by directory id.`,
    };
  }
  if (res.missing.length > 0) {
    return {
      code: "CHAT_DIRECTORY_MENTION_NOT_FOUND",
      message: `Unknown folder mention(s): ${res.missing
        .map((m) => `@${m}`)
        .join(", ")}. Create the folder or remove the mention.`,
    };
  }
  return {
    code: "CHAT_DIRECTORY_MENTION_ERROR",
    message: "Failed to resolve folder mentions.",
  };
}
