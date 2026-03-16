// Assistant Stream command handler

import { wsSend } from "../chat.controller.helpers";
import type { WsCommandHandler, WsContext } from "./wsCommand.types";

interface AssistantStreamPayload {
  text: string;
  clientMessageId?: string;
  defaultDirectoryIds?: string[];
  mode?: number;
}

export class AssistantStreamCommandHandler implements WsCommandHandler {
  readonly type = "assistant.stream";

  handle(context: WsContext, payload: unknown): Promise<void> {
    const { socket, deps, threadId, userId, companyId, tag, stream } = context;
    const typedPayload = payload as AssistantStreamPayload;

    // Ack immediately so UI gets confirmation
    wsSend(socket, {
      type: "ack",
      payload: {
        ok: true,
        clientMessageId: typedPayload.clientMessageId ?? null,
      },
    });

    // Abort previous stream on this socket
    if (stream.abortController) {
      try {
        stream.abortController.abort();
      } catch (e) {
        console.warn(tag, "failed to abort previous AI stream", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const ac = new AbortController();
    stream.abortController = ac;

    const defaultDirectoryIds = typedPayload.defaultDirectoryIds ?? [];
    const mode = typedPayload.mode;

    // Fire-and-forget; service itself should broadcast message.created + deltas
    void deps.aiStreamService
      .streamAssistantReply({
        userId,
        companyId,
        threadId,
        text: typedPayload.text,
        clientMessageId: typedPayload.clientMessageId ?? undefined,
        defaultDirectoryIds,
        mode,
        signal: ac.signal,
      })
      .catch((err) => {
        // If aborted (client sent another stream or socket closed) — silence
        if (ac.signal.aborted) return;

        const msg = err instanceof Error ? err.message : String(err);
        console.error(tag, "ai stream failed", { message: msg });

        // Send structured error to this socket (not broadcast to whole thread)
        wsSend(socket, {
          type: "error",
          payload: { code: "AI_STREAM_FAILED", message: msg },
        });
      })
      .finally(() => {
        // Clear only if this is still the active controller
        if (stream.abortController === ac) {
          stream.abortController = null;
        }
      });

    return Promise.resolve();
  }
}
