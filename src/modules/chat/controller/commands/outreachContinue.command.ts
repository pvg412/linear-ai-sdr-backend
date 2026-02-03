// Outreach Continue command handler - continues to next lead without messages

import { wsSend } from "../chat.controller.helpers";
import type { WsCommandHandler, WsContext } from "./wsCommand.types";

interface OutreachContext {
  channel?: string;
  stage?: string;
  dayInSequence?: number;
  followUpNumber?: number;
  suggestedTactic?: string;
  customInstructions?: string;
  userPrompt?: string;
}

interface OutreachContinuePayload {
  directoryId: string;
  currentLeadId?: string;
  clientMessageId?: string;
  context?: OutreachContext; // Context from first outreach.prompt.apply
}

export class OutreachContinueCommandHandler implements WsCommandHandler {
  readonly type = "outreach.continue";

  async handle(context: WsContext, payload: unknown): Promise<void> {
    const { socket, deps, threadId, userId } = context;
    const typedPayload = payload as OutreachContinuePayload;

    console.log("[OutreachContinueCommand] Received request", {
      userId,
      threadId,
      payload: typedPayload,
    });

    // Validate payload
    if (!typedPayload.directoryId || typeof typedPayload.directoryId !== "string") {
      console.error("[OutreachContinueCommand] Invalid payload - missing directoryId");
      wsSend(socket, {
        type: "error",
        payload: {
          code: "INVALID_PAYLOAD",
          message: "directoryId must be a non-empty string",
        },
      });
      return;
    }

    // Send acknowledgment
    wsSend(socket, {
      type: "ack",
      payload: {
        ok: true,
        clientMessageId: typedPayload.clientMessageId ?? null,
      },
    });

    // Trigger outreach continuation
    try {
      console.log("[OutreachContinueCommand] Calling continueOutreach", {
        userId,
        threadId,
        directoryId: typedPayload.directoryId,
        currentLeadId: typedPayload.currentLeadId,
        hasContext: !!typedPayload.context,
      });

      await deps.aiStreamService.continueOutreach({
        userId,
        threadId,
        directoryId: typedPayload.directoryId,
        currentLeadId: typedPayload.currentLeadId,
        outreachContext: typedPayload.context, // Pass the saved context from frontend
      });

      console.log("[OutreachContinueCommand] Successfully triggered continueOutreach");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OutreachContinueCommand] Failed", { error: msg, stack: err instanceof Error ? err.stack : undefined });

      wsSend(socket, {
        type: "error",
        payload: {
          code: "OUTREACH_CONTINUE_FAILED",
          message: msg,
        },
      });
    }
  }
}
