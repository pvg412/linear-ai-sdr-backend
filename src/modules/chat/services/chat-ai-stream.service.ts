import { inject, injectable } from "inversify";
import { randomUUID } from "crypto";
import * as grpc from "@grpc/grpc-js";
import { ChatMessageRole, ChatMessageType, Prisma } from "@prisma/client";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";

import { ChatRepository } from "../persistence/chat.repository";
import { CHAT_TYPES } from "../chat.types";

import { extractFolderMentions, stripMentions } from "../utils/folder-mentions";
import { sanitizeMessageToPublic } from "../parsers/chat.parsers";

import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";

import type {
  ChatStreamEvent,
  ChatStreamRequest,
  OutreachMessage as PbOutreachMessage,
  OutreachContext as PbOutreachContext,
} from "@/generated/aisdr/v1/ai_sdr";
import {
  ChatMessageRole as PbRole,
  ChatMessageType as PbType,
  ChatMode,
  LeadResponseType as PbLeadResponseType,
  OutreachChannel as PbOutreachChannel,
  OutreachStage as PbOutreachStage,
  OutreachTactic as PbOutreachTactic,
  outreachChannelToJSON,
  outreachStageToJSON,
} from "@/generated/aisdr/v1/ai_sdr";

import { LEAD_DIRECTORY_TYPES } from "@/modules/lead-directory/lead-directory.types";
import type {
  LeadDirectoryMentionResolver,
  ResolveMentionsResult,
} from "@/modules/lead-directory/services/lead-directory-mention-resolver.service";

type Json = Prisma.InputJsonValue;
type UnknownRecord = Record<string, unknown>;

type Citation = {
  documentId: string;
  leadId?: string;
  directoryId?: string;
  score?: number;
  snippet?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseCitations(itemsUnknown: unknown): Citation[] {
  if (!Array.isArray(itemsUnknown)) return [];

  const out: Citation[] = [];
  for (const it of itemsUnknown) {
    if (!isRecord(it)) continue;

    const documentId =
      readString(it, "documentId") ?? readString(it, "document_id");
    if (!documentId) continue;

    const leadId = readString(it, "leadId") ?? readString(it, "lead_id");
    const directoryId =
      readString(it, "directoryId") ?? readString(it, "directory_id");
    const score = readNumber(it, "score");
    const snippet = readString(it, "snippet");

    out.push({ documentId, leadId, directoryId, score, snippet });
  }

  return out;
}

type OutreachMessageJson = {
  type: "outreach";
  channel: string;
  stage: string;
  subject: string;
  body: string;
  variants: string[];
  characterCount: number;
  wordCount: number;
  containsLink: boolean;
  usageNote?: string;
};

function parseOutreachMessage(
  outreach: PbOutreachMessage,
): OutreachMessageJson {
  return {
    type: "outreach",
    channel: outreachChannelToJSON(outreach.channel),
    stage: outreachStageToJSON(outreach.stage),
    subject: outreach.subject || "",
    body: outreach.body || "",
    variants: outreach.variants || [],
    characterCount: outreach.characterCount || 0,
    wordCount: outreach.wordCount || 0,
    containsLink: outreach.containsLink || false,
    usageNote: outreach.usageNote || undefined,
  };
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
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

function mapStringToOutreachChannel(channel: string): PbOutreachChannel {
  switch (channel) {
    case "EMAIL":
      return PbOutreachChannel.OUTREACH_CHANNEL_EMAIL;
    case "LINKEDIN":
      return PbOutreachChannel.OUTREACH_CHANNEL_LINKEDIN;
    default:
      return PbOutreachChannel.OUTREACH_CHANNEL_UNSPECIFIED;
  }
}

function mapStringToOutreachStage(stage: string): PbOutreachStage {
  switch (stage) {
    case "CONNECTION_REQUEST":
      return PbOutreachStage.OUTREACH_STAGE_CONNECTION_REQUEST;
    case "POST_ACCEPT_FIRST_MESSAGE":
      return PbOutreachStage.OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE;
    case "LINKEDIN_FOLLOW_UP_1":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1;
    case "LINKEDIN_FOLLOW_UP_2":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2;
    case "LINKEDIN_CLOSE_LOOP":
      return PbOutreachStage.OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP;
    case "COLD_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_COLD_EMAIL;
    case "WARM_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_WARM_EMAIL;
    case "INTRODUCTION_EMAIL":
      return PbOutreachStage.OUTREACH_STAGE_INTRODUCTION_EMAIL;
    case "EMAIL_FOLLOW_UP_1":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_1;
    case "EMAIL_FOLLOW_UP_2":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_2;
    case "EMAIL_CLOSE_LOOP":
      return PbOutreachStage.OUTREACH_STAGE_EMAIL_CLOSE_LOOP;
    case "FOLLOW_UP_NO_REPLY":
      return PbOutreachStage.OUTREACH_STAGE_FOLLOW_UP_NO_REPLY;
    case "AFTER_POSITIVE_REPLY":
      return PbOutreachStage.OUTREACH_STAGE_AFTER_POSITIVE_REPLY;
    case "REPLY_TO_QUESTION":
      return PbOutreachStage.OUTREACH_STAGE_REPLY_TO_QUESTION;
    default:
      return PbOutreachStage.OUTREACH_STAGE_UNSPECIFIED;
  }
}

function mapStringToOutreachTactic(tactic: string): PbOutreachTactic {
  switch (tactic) {
    case "OPTIONS":
      return PbOutreachTactic.OUTREACH_TACTIC_OPTIONS;
    case "MINI_PLAN":
      return PbOutreachTactic.OUTREACH_TACTIC_MINI_PLAN;
    case "TEASE":
      return PbOutreachTactic.OUTREACH_TACTIC_TEASE;
    case "RESOURCE":
      return PbOutreachTactic.OUTREACH_TACTIC_RESOURCE;
    case "SOCIAL_PROOF":
      return PbOutreachTactic.OUTREACH_TACTIC_SOCIAL_PROOF;
    case "CLOSE_LOOP":
      return PbOutreachTactic.OUTREACH_TACTIC_CLOSE_LOOP;
    default:
      return PbOutreachTactic.OUTREACH_TACTIC_UNSPECIFIED;
  }
}

function getEventPayload(ev: ChatStreamEvent): {
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

function formatMentionError(res: ResolveMentionsResult): {
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

  async streamAssistantReply(input: {
    userId: string;
    threadId: string;
    text: string;

    clientMessageId?: string;
    defaultDirectoryIds?: string[];
    mode?: ChatMode;
    outreachContext?: {
      channel: string;
      stage: string;
      dayInSequence?: number;
      followUpNumber?: number;
      suggestedTactic?: string;
      leadResponseType?: string;
      customInstructions?: string;
      leadId?: string;
      userPrompt?: string;
    };

    signal?: AbortSignal;
  }): Promise<void> {
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
    if (input.outreachContext?.leadId && !leadIds.includes(input.outreachContext.leadId)) {
      leadIds = [input.outreachContext.leadId, ...leadIds];
    }

    const LIMIT_MESSAGES_FOR_AI = 15;

    const history = await this.chatRepo.listRecentMessagesForAi(
      input.userId,
      input.threadId,
      LIMIT_MESSAGES_FOR_AI,
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
    const textForAi = stripMentions(cleanedText.length > 0 ? cleanedText : input.text);

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
        createdAtMs: String(userMsg?.createdAt ? Date.parse(String(userMsg.createdAt)) : Date.now()),
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

    // delta batching (so you don’t spam WS per-token)
    let pendingDelta = "";
    let lastFlushAt = Date.now();
    const flush = () => {
      const delta = pendingDelta;
      if (!delta) return;
      pendingDelta = "";
      lastFlushAt = Date.now();

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
            pendingDelta += delta;

            const now = Date.now();
            // flush at ~50ms or if big chunk
            if (pendingDelta.length >= 64 || now - lastFlushAt >= 50) {
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
          let messagePayload: Json = { citations: finalCitations } as unknown as Json;

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
