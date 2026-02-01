import { inject, injectable } from "inversify";
import { randomUUID } from "crypto";
import { ChatMessageRole, ChatMessageType } from "@prisma/client";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";

import { ChatRepository } from "../persistence/chat.repository";
import { CHAT_TYPES } from "../chat.types";

import { extractFolderMentions, stripMentions } from "../utils/folder-mentions";
import { sanitizeMessageToPublic } from "../parsers/chat.parsers";

import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";

import type {
  ChatStreamRequest,
  OutreachContext as PbOutreachContext,
  OutreachMessage as PbOutreachMessage,
} from "@/generated/aisdr/v1/ai_sdr";
import {
  ChatMessageRole as PbRole,
  ChatMessageType as PbType,
  ChatMode,
  LeadResponseType as PbLeadResponseType,
  OutreachTactic as PbOutreachTactic,
} from "@/generated/aisdr/v1/ai_sdr";

import { LEAD_DIRECTORY_TYPES } from "@/modules/lead-directory/lead-directory.types";
import type { LeadDirectoryMentionResolver } from "@/modules/lead-directory/services/lead-directory-mention-resolver.service";
import { CHAT_CONSTANTS } from "@/config/constants";

import {
  type Citation,
  type Json,
  type StreamAssistantInput,
  type UnknownRecord,
  isRecord,
  readString,
  parseCitations,
  parseOutreachMessage,
  mapStringToOutreachChannel,
  mapStringToOutreachStage,
  mapStringToOutreachTactic,
  getEventPayload,
  createDeltaBuffer,
  appendDelta,
  shouldFlush,
  flushBuffer,
  isAbortError,
  formatMentionError,
} from "./stream";

@injectable()
export class ChatAiStreamService {
  constructor(
    @inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    private readonly ai: AiGrpcClient,

    @inject(CHAT_TYPES.ChatRepository)
    private readonly chatRepo: ChatRepository,

    @inject(REALTIME_TYPES.RealtimeHub)
    private readonly realtimeHub: RealtimeHub,

    @inject(LEAD_DIRECTORY_TYPES.LeadDirectoryMentionResolver)
    private readonly dirResolver: LeadDirectoryMentionResolver,
  ) { }

  async streamAssistantReply(input: StreamAssistantInput): Promise<void> {
    const requestId = randomUUID();
    const workspaceId = input.userId;

    // 1) persist USER message (skip if we have outreach context - it already has USER JSON message)
    let userMsg: { id: string; createdAt: string | Date } | null = null;

    if (input.text.trim().length > 0 && !input.outreachContext) {
      userMsg = await this.chatRepo.createMessage({
        ownerId: input.userId,
        threadId: input.threadId,
        role: ChatMessageRole.USER,
        type: ChatMessageType.TEXT,
        text: input.text,
        payload: null,
        authorUserId: input.userId,
      });

      this.realtimeHub.broadcast(input.threadId, {
        type: "message.created",
        payload: {
          message: sanitizeMessageToPublic(userMsg as unknown as UnknownRecord),
        },
      });
    }

    // 2) @folder mentions → filter leadIds by directories
    const { cleanedText, mentions } = extractFolderMentions(input.text);

    let directoryIds: string[] = input.defaultDirectoryIds ?? [];

    if (mentions.length > 0) {
      const resolved = await this.dirResolver.resolve(input.userId, mentions);

      if (resolved.ambiguous.length > 0 || resolved.missing.length > 0) {
        const err = formatMentionError(resolved);

        const errMsg = await this.chatRepo.createMessage({
          ownerId: input.userId,
          threadId: input.threadId,
          role: ChatMessageRole.ASSISTANT,
          type: ChatMessageType.EVENT,
          text: err.message,
          payload: {
            event: "chat.directory.scope.error",
            requestId,
            code: err.code,
            missing: resolved.missing,
            ambiguous: resolved.ambiguous,
            mentions,
          } as unknown as Json,
          authorUserId: null,
        });

        this.realtimeHub.broadcast(input.threadId, {
          type: "message.created",
          payload: {
            message: sanitizeMessageToPublic(
              errMsg as unknown as UnknownRecord,
            ),
          },
        });

        this.realtimeHub.broadcast(input.threadId, {
          type: "assistant.error",
          payload: {
            requestId,
            clientMessageId: input.clientMessageId ?? null,
            code: err.code,
            message: err.message,
            retryable: false,
          },
        });

        return;
      }

      directoryIds = resolved.directoryIds;
    }

    // 3) Fetch leadIds from directories (backend filtering)
    let leadIds = await this.chatRepo.getLeadIdsFromDirectories(
      input.userId,
      directoryIds,
    );

    // If outreach context has a specific leadId, add it to leadIds
    if (
      input.outreachContext?.leadId &&
      !leadIds.includes(input.outreachContext.leadId)
    ) {
      leadIds = [input.outreachContext.leadId, ...leadIds];
    }

    const history = await this.chatRepo.listRecentMessagesForAi(
      input.userId,
      input.threadId,
      CHAT_CONSTANTS.LIMIT_MESSAGES_FOR_AI,
    );

    const pbHistory = history
      .filter(
        (m) =>
          m.type === ChatMessageType.TEXT &&
          typeof m.text === "string" &&
          m.text.trim().length > 0,
      )
      .map((m) => ({
        messageId: m.id,
        role:
          m.role === ChatMessageRole.USER
            ? PbRole.CHAT_MESSAGE_ROLE_USER
            : PbRole.CHAT_MESSAGE_ROLE_ASSISTANT,
        type: PbType.CHAT_MESSAGE_TYPE_TEXT,
        text: m.text ?? "",
        createdAtMs: String(Date.parse(m.createdAt)),
      }));

    // Build outreach context if provided (pre-parsed from outreach.prompt.apply)
    let outreachContext: PbOutreachContext | undefined;

    if (input.outreachContext) {
      const ctx = input.outreachContext;

      outreachContext = {
        channel: mapStringToOutreachChannel(ctx.channel),
        stage: mapStringToOutreachStage(ctx.stage),
        dayInSequence: ctx.dayInSequence ?? 0,
        followUpNumber: ctx.followUpNumber ?? 0,
        suggestedTactic: ctx.suggestedTactic
          ? mapStringToOutreachTactic(ctx.suggestedTactic)
          : PbOutreachTactic.OUTREACH_TACTIC_UNSPECIFIED,
        leadResponseType: PbLeadResponseType.LEAD_RESPONSE_TYPE_NO_RESPONSE,
        leadLastReply: "",
        previousMessages: [],
        customInstructions: ctx.customInstructions ?? "",
        assetPermissionGranted: false,
        assetToSend: "",
      };
    }

    // Strip all @mentions before sending to AI
    const textForAi = stripMentions(
      cleanedText.length > 0 ? cleanedText : input.text,
    );

    const req: ChatStreamRequest = {
      requestId,
      workspaceId,
      threadId: input.threadId,
      userId: input.userId,

      userMessage: {
        messageId: userMsg?.id ?? `temp-${requestId}`,
        role: PbRole.CHAT_MESSAGE_ROLE_USER,
        type: PbType.CHAT_MESSAGE_TYPE_TEXT,
        text: textForAi,
        createdAtMs: String(
          userMsg?.createdAt ? Date.parse(String(userMsg.createdAt)) : Date.now(),
        ),
      },

      history: pbHistory,

      context: {
        leadIds,
      },

      debug: false,

      mode: input.mode ?? ChatMode.CHAT_MODE_ASSISTANCE,

      outreachContext,
    };

    // ✅ notify start
    this.realtimeHub.broadcast(input.threadId, {
      type: "assistant.started",
      payload: {
        requestId,
        clientMessageId: input.clientMessageId ?? null,
        userMessageId: userMsg?.id ?? null,
      },
    });

    // 4) stream
    let accText = "";
    let lastCitations: Citation[] = [];
    let finalized = false;

    // delta batching (so you don't spam WS per-token)
    const deltaBuffer = createDeltaBuffer();

    const flush = () => {
      const delta = flushBuffer(deltaBuffer);
      if (!delta) return;

      this.realtimeHub.broadcast(input.threadId, {
        type: "assistant.delta",
        payload: {
          requestId,
          clientMessageId: input.clientMessageId ?? null,
          delta,
        },
      });
    };

    try {
      for await (const ev of this.ai.chatStream(req, {
        signal: input.signal,
      })) {
        const p = getEventPayload(ev);

        if (p.kind === "token" && p.data) {
          const delta = readString(p.data, "text") ?? "";
          if (delta) {
            accText += delta;
            appendDelta(deltaBuffer, delta);

            if (shouldFlush(deltaBuffer)) {
              flush();
            }
          }
          continue;
        }

        if (p.kind === "retrieval" && p.data) {
          lastCitations = parseCitations(p.data["items"]);
          continue;
        }

        if (p.kind === "final" && p.data && !finalized) {
          finalized = true;

          flush();

          const text = readString(p.data, "text") ?? accText;

          const citations = parseCitations(p.data["citations"]);
          const finalCitations =
            citations.length > 0 ? citations : lastCitations;

          // Check if this is an outreach message
          const outreachUnknown = p.data["outreach"];
          const isOutreach = outreachUnknown && isRecord(outreachUnknown);

          let messageType: ChatMessageType = ChatMessageType.TEXT;
          let messagePayload: Json = {
            citations: finalCitations,
          } as unknown as Json;

          // If outreach message is present, parse it and set type to OUTREACH
          if (isOutreach) {
            messageType = ChatMessageType.OUTREACH;
            const outreachData = parseOutreachMessage(
              outreachUnknown as unknown as PbOutreachMessage,
            );
            messagePayload = {
              ...outreachData,
              citations: finalCitations,
            } as unknown as Json;
          }

          const assistantMsg = await this.chatRepo.createMessage({
            ownerId: input.userId,
            threadId: input.threadId,
            role: ChatMessageRole.ASSISTANT,
            type: messageType,
            text,
            payload: messagePayload,
            authorUserId: null,
          });

          this.realtimeHub.broadcast(input.threadId, {
            type: "message.created",
            payload: {
              message: sanitizeMessageToPublic(
                assistantMsg as unknown as UnknownRecord,
              ),
            },
          });

          this.realtimeHub.broadcast(input.threadId, {
            type: "assistant.final",
            payload: {
              requestId,
              clientMessageId: input.clientMessageId ?? null,
              assistantMessageId: assistantMsg.id,
            },
          });

          continue;
        }

        if (p.kind === "error" && p.data && !finalized) {
          finalized = true;

          flush();

          const code = readString(p.data, "code") ?? "AI_STREAM_ERROR";
          const message = readString(p.data, "message") ?? "AI stream error";
          const retryable = Boolean(p.data["retryable"]);

          const errMsg = await this.chatRepo.createMessage({
            ownerId: input.userId,
            threadId: input.threadId,
            role: ChatMessageRole.ASSISTANT,
            type: ChatMessageType.EVENT,
            text: message,
            payload: {
              event: "assistant.error",
              requestId,
              code,
              retryable,
            } as unknown as Json,
            authorUserId: null,
          });

          this.realtimeHub.broadcast(input.threadId, {
            type: "message.created",
            payload: {
              message: sanitizeMessageToPublic(
                errMsg as unknown as UnknownRecord,
              ),
            },
          });

          this.realtimeHub.broadcast(input.threadId, {
            type: "assistant.error",
            payload: {
              requestId,
              clientMessageId: input.clientMessageId ?? null,
              code,
              message,
              retryable,
            },
          });

          continue;
        }
      }

      // flush leftovers if stream ends without final (rare)
      if (!finalized) flush();
    } catch (e) {
      if (isAbortError(e, input.signal)) return;

      const msg = e instanceof Error ? e.message : String(e);

      const errMsg = await this.chatRepo.createMessage({
        ownerId: input.userId,
        threadId: input.threadId,
        role: ChatMessageRole.ASSISTANT,
        type: ChatMessageType.EVENT,
        text: msg,
        payload: {
          event: "assistant.error",
          requestId,
          code: "INTERNAL",
        } as unknown as Json,
        authorUserId: null,
      });

      this.realtimeHub.broadcast(input.threadId, {
        type: "message.created",
        payload: {
          message: sanitizeMessageToPublic(errMsg as unknown as UnknownRecord),
        },
      });

      this.realtimeHub.broadcast(input.threadId, {
        type: "assistant.error",
        payload: {
          requestId,
          clientMessageId: input.clientMessageId ?? null,
          code: "INTERNAL",
          message: msg,
          retryable: false,
        },
      });
    }
  }
}
