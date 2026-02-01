// Outreach Prompt Parse command handler

import { outreachChannelToJSON } from "@/generated/aisdr/v1/ai_sdr";
import { wsSend, type UnknownRecord } from "../chat.controller.helpers";
import { sanitizeMessageToPublic } from "../../parsers/chat.parsers";
import type { WsCommandHandler, WsContext } from "./wsCommand.types";

interface OutreachPromptParsePayload {
  text: string;
  directoryId: string;
  suggestedChannel?: number;
  clientMessageId?: string;
}

export class OutreachPromptParseCommandHandler implements WsCommandHandler {
  readonly type = "outreach.prompt.parse";

  async handle(context: WsContext, payload: unknown): Promise<void> {
    const { socket, deps, threadId, userId, tag } = context;
    const typedPayload = payload as OutreachPromptParsePayload;

    const suggestedChannel = typedPayload.suggestedChannel
      ? outreachChannelToJSON(typedPayload.suggestedChannel)
      : undefined;

    console.log(tag, "outreach.prompt.parse - input", {
      suggestedChannelRaw: typedPayload.suggestedChannel,
      suggestedChannelConverted: suggestedChannel,
      text: typedPayload.text,
      directoryId: typedPayload.directoryId,
    });

    const result = await deps.commandService.parseOutreachPrompt(
      userId,
      threadId,
      {
        text: typedPayload.text,
        directoryId: typedPayload.directoryId,
        suggestedChannel,
      },
    );

    console.log(tag, "outreach.prompt.parse - result", {
      parsed: result.parsed,
      assistantMessagePayload: result.assistantMessage.payload,
    });

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.userMessage as unknown as UnknownRecord,
        ),
      },
    });

    deps.realtimeHub.broadcast(threadId, {
      type: "message.created",
      payload: {
        message: sanitizeMessageToPublic(
          result.assistantMessage as unknown as UnknownRecord,
        ),
      },
    });

    wsSend(socket, {
      type: "ack",
      payload: {
        ok: true,
        clientMessageId: typedPayload.clientMessageId ?? undefined,
      },
    });
  }
}
