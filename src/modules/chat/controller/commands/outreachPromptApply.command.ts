// Outreach Prompt Apply command handler

import {
  outreachChannelToJSON,
  outreachStageToJSON,
} from "@/generated/aisdr/v1/ai_sdr";
import { wsSend, type UnknownRecord } from "../chat.controller.helpers";
import { sanitizeMessageToPublic } from "../../parsers/chat.parsers";
import type { WsCommandHandler, WsContext } from "./wsCommand.types";

interface OutreachContext {
  channel: number;
  stage: number;
  dayInSequence?: number;
  followUpNumber?: number;
  suggestedTactic?: string;
  leadResponseType?: string;
  customInstructions?: string;
  leadId?: string;
  userPrompt?: string;
}

interface OutreachPromptApplyPayload {
  context: OutreachContext;
  parsedMessageId?: string;
  defaultDirectoryIds?: string[];
  clientMessageId?: string;
}

export class OutreachPromptApplyCommandHandler implements WsCommandHandler {
  readonly type = "outreach.prompt.apply";

  async handle(context: WsContext, payload: unknown): Promise<void> {
    const { socket, deps, threadId, userId, tag, stream } = context;
    const typedPayload = payload as OutreachPromptApplyPayload;

    const outreachContext = {
      channel: outreachChannelToJSON(typedPayload.context.channel),
      stage: outreachStageToJSON(typedPayload.context.stage),
      dayInSequence: typedPayload.context.dayInSequence,
      followUpNumber: typedPayload.context.followUpNumber,
      suggestedTactic: typedPayload.context.suggestedTactic,
      leadResponseType: typedPayload.context.leadResponseType,
      customInstructions: typedPayload.context.customInstructions,
      leadId: typedPayload.context.leadId,
      userPrompt: typedPayload.context.userPrompt,
    };

    const result = await deps.commandService.applyOutreachContext(
      userId,
      threadId,
      {
        context: outreachContext,
        parsedMessageId: typedPayload.parsedMessageId,
        defaultDirectoryIds: typedPayload.defaultDirectoryIds,
      },
    );

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.userJsonMessage as unknown as UnknownRecord,
        ),
      },
    });

    wsSend(socket, {
      type: "ack",
      payload: {
        ok: true,
        clientMessageId: typedPayload.clientMessageId ?? null,
      },
    });

    // Now trigger the AI stream with the context
    const ac = new AbortController();
    stream.abortController = ac;

    const defaultDirectoryIds = typedPayload.defaultDirectoryIds ?? [];
    const userPrompt = typedPayload.context.userPrompt ?? "";

    void deps.aiStreamService
      .streamAssistantReply({
        userId,
        threadId,
        text: userPrompt,
        clientMessageId: typedPayload.clientMessageId ?? undefined,
        defaultDirectoryIds,
        mode: 2, // ChatMode.CHAT_MODE_OUTREACH
        outreachContext,
        signal: ac.signal,
      })
      .catch((err) => {
        if (ac.signal.aborted) return;

        const msg = err instanceof Error ? err.message : String(err);
        console.error(tag, "ai stream failed", { message: msg });

        wsSend(socket, {
          type: "error",
          payload: { code: "AI_STREAM_FAILED", message: msg },
        });
      })
      .finally(() => {
        if (stream.abortController === ac) {
          stream.abortController = null;
        }
      });
  }
}
