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
  OutreachChannel as PbOutreachChannel,
  OutreachStage as PbOutreachStage,
  OutreachTactic as PbOutreachTactic,
} from "@/generated/aisdr/v1/ai_sdr";

import { LEAD_DIRECTORY_TYPES } from "@/modules/lead-directory/lead-directory.types";
import type { LeadDirectoryMentionResolver } from "@/modules/lead-directory/services/lead-directory-mention-resolver.service";
import { CHAT_CONSTANTS } from "@/config/constants";
import { LEAD_CONVERSATIONS_TYPES } from "@/modules/lead-conversations/lead-conversations.types";
import type { LeadConversationsRepository } from "@/modules/lead-conversations/persistence/lead-conversations.repository";
import type { OutreachCadenceService } from "@/modules/lead-conversations/services/outreach-cadence.service";

import {
  type Citation,
  type Json,
  type StreamAssistantInput,
  type UnknownRecord,
  isRecord,
  readString,
  parseCitations,
  parseOutreachMessage,
  parseOutreachVariants,
  mapStringToOutreachChannel,
  mapStringToOutreachStage,
  mapStringToOutreachTactic,
  mapPrismaChannelToProtobuf,
  mapPrismaStageToProtobuf,
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

    @inject(LEAD_CONVERSATIONS_TYPES.LeadConversationsRepository)
    private readonly conversationsRepo: LeadConversationsRepository,

    @inject(LEAD_CONVERSATIONS_TYPES.OutreachCadenceService)
    private readonly cadenceService: OutreachCadenceService,
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

    // If outreach context has directoryId, use it
    if (input.outreachContext?.directoryId) {
      directoryIds = [input.outreachContext.directoryId];
    }
    // If outreach context has directoryIds array, use it
    else if (input.outreachContext?.directoryIds && input.outreachContext.directoryIds.length > 0) {
      directoryIds = input.outreachContext.directoryIds;
    }

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

    // Track the actual leadId we're working with for outreach
    let actualOutreachLeadId: string | undefined;

    // For outreach mode, filter leads based on minimum message count
    // Only leads with the minimum number of messages should be included
    if (input.outreachContext && input.mode === ChatMode.CHAT_MODE_OUTREACH) {
      // Get leads with minimum message count (those that need the next message)
      const { leadIds: leadsAtMinCount, minMessageCount } =
        await this.conversationsRepo.filterLeadsWithMinMessageCount(leadIds);

      console.log('[ChatAiStreamService] Outreach lead filtering (min message count):', {
        requestedLeadId: input.outreachContext.leadId,
        totalLeadsInDirectory: leadIds.length,
        minMessageCount,
        leadsAtMinCount: leadsAtMinCount.length,
        leadsAtMinCountPreview: leadsAtMinCount.slice(0, 5),
      });

      // Check cadence timing - if all leads have at least one message,
      // we need to check if enough days have passed for the next follow-up
      if (minMessageCount > 0) {
        // Get the earliest last message date among leads at minimum count
        const earliestLastMessageDate = await this.conversationsRepo.getEarliestLastMessageDate(leadIds);

        // Validate cadence timing
        const cadenceValidation = this.cadenceService.validateCadenceTiming(
          minMessageCount,
          earliestLastMessageDate,
        );

        console.log('[ChatAiStreamService] Cadence timing validation:', {
          minMessageCount,
          earliestLastMessageDate,
          cadenceValidation,
        });

        if (!cadenceValidation.canProceed) {
          // Not enough days have passed - send waiting event
          this.realtimeHub.broadcast(input.threadId, {
            type: "outreach.cadence_wait",
            payload: {
              message: `Next follow-up (${cadenceValidation.followUpNumber}) available in ${cadenceValidation.daysRemaining} day(s)`,
              daysRemaining: cadenceValidation.daysRemaining,
              nextAvailableDate: cadenceValidation.nextAvailableDate?.toISOString() ?? null,
              followUpNumber: cadenceValidation.followUpNumber,
              dayInSequence: cadenceValidation.dayInSequence,
              directoryId: directoryIds[0],
            },
          });
          return;
        }
      }

      if (leadsAtMinCount.length === 0) {
        // This shouldn't happen if leadIds has items, but handle edge case
        console.warn('[ChatAiStreamService] No leads found at minimum count', {
          directoryIds,
          totalLeadsChecked: leadIds.length,
        });

        this.realtimeHub.broadcast(input.threadId, {
          type: "outreach.completed",
          payload: {
            message: "All leads in the directory have been contacted",
            directoryId: directoryIds[0],
          },
        });
        return;
      }

      // Use first lead at minimum message count
      actualOutreachLeadId = leadsAtMinCount[0];

      // Update leadIds to only include leads at minimum count
      leadIds = leadsAtMinCount;
    } else if (input.outreachContext?.leadId) {
      // Non-outreach mode or legacy: use the requested leadId if in directory
      const requestedLeadId = input.outreachContext.leadId;

      if (leadIds.includes(requestedLeadId)) {
        actualOutreachLeadId = requestedLeadId;
        leadIds = [
          requestedLeadId,
          ...leadIds.filter(id => id !== requestedLeadId)
        ];
      } else {
        actualOutreachLeadId = leadIds[0];
      }
    } else if (leadIds.length > 0) {
      // No specific leadId requested, use first from directory
      actualOutreachLeadId = leadIds[0];
    }

    console.log('[ChatAiStreamService] Final lead resolution:', {
      actualOutreachLeadId,
      directoryIds,
      totalLeads: leadIds.length,
      leadIdsPreview: leadIds.slice(0, 3),
      mode: input.mode,
    });

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

      // Load previous messages from conversation history using the actual lead ID
      let previousMessages: PbOutreachContext["previousMessages"] = [];
      if (actualOutreachLeadId) {
        const conversationHistory = await this.conversationsRepo.findByLeadId({
          leadId: actualOutreachLeadId,
          limit: 10, // Last 10 messages
          offset: 0,
        });

        previousMessages = conversationHistory.messages.map((msg) => ({
          channel: mapPrismaChannelToProtobuf(msg.channel),
          stage: mapPrismaStageToProtobuf(msg.stage),
          body: msg.body,
          sentAtMs: msg.sentAt ? String(msg.sentAt.getTime()) : "0",
          responseType: PbLeadResponseType.LEAD_RESPONSE_TYPE_NO_RESPONSE,
          leadReply: "",
        }));
      }

      outreachContext = {
        channel: ctx.channel
          ? mapStringToOutreachChannel(ctx.channel)
          : PbOutreachChannel.OUTREACH_CHANNEL_EMAIL, // Default to email if not specified
        stage: ctx.stage
          ? mapStringToOutreachStage(ctx.stage)
          : PbOutreachStage.OUTREACH_STAGE_COLD_EMAIL, // Default to cold email if not specified
        dayInSequence: ctx.dayInSequence ?? 0,
        followUpNumber: ctx.followUpNumber ?? 0,
        suggestedTactic: ctx.suggestedTactic
          ? mapStringToOutreachTactic(ctx.suggestedTactic)
          : PbOutreachTactic.OUTREACH_TACTIC_UNSPECIFIED,
        leadResponseType: PbLeadResponseType.LEAD_RESPONSE_TYPE_NO_RESPONSE,
        leadLastReply: "",
        previousMessages,
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

          // Check if this is an outreach message (new format with variants array)
          const outreachVariantsUnknown = p.data["outreachVariants"];
          const hasOutreachVariants =
            Array.isArray(outreachVariantsUnknown) && outreachVariantsUnknown.length > 0;

          // Legacy support: check for single outreach message
          const outreachUnknown = p.data["outreach"];
          const hasLegacyOutreach = outreachUnknown && isRecord(outreachUnknown);

          let messageType: ChatMessageType = ChatMessageType.TEXT;
          let messagePayload: Json = {
            citations: finalCitations,
          } as unknown as Json;

          // If outreach variants are present (new format), parse them
          if (hasOutreachVariants) {
            messageType = ChatMessageType.OUTREACH;
            const outreachData = parseOutreachVariants(
              outreachVariantsUnknown as unknown as PbOutreachMessage[],
            );
            messagePayload = {
              ...outreachData,
              citations: finalCitations,
            } as unknown as Json;
          }
          // Legacy support: if single outreach message is present
          else if (hasLegacyOutreach) {
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
            leadId: messageType === ChatMessageType.OUTREACH ? actualOutreachLeadId : null,
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

          // If this was an outreach message, send completion event for this lead
          if (messageType === ChatMessageType.OUTREACH && actualOutreachLeadId) {
            this.realtimeHub.broadcast(input.threadId, {
              type: "outreach.lead_completed",
              payload: {
                leadId: actualOutreachLeadId,
                assistantMessageId: assistantMsg.id,
                hasVariants: hasOutreachVariants || hasLegacyOutreach,
              },
            });
          }

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

  /**
   * Continue outreach to the next lead without messages
   */
  async continueOutreach(input: {
    userId: string;
    threadId: string;
    directoryId: string;
    currentLeadId?: string;
    outreachContext?: {
      channel?: string;
      stage?: string;
      dayInSequence?: number;
      followUpNumber?: number;
      suggestedTactic?: string;
      customInstructions?: string;
      userPrompt?: string;
    };
  }): Promise<void> {
    console.log("[ChatAiStreamService] continueOutreach - start", {
      userId: input.userId,
      threadId: input.threadId,
      directoryId: input.directoryId,
      currentLeadId: input.currentLeadId,
    });

    // Get leads without messages from the directory
    const leadIds = await this.chatRepo.getLeadIdsFromDirectories(
      input.userId,
      [input.directoryId],
      { excludeWithMessages: true },
    );

    console.log("[ChatAiStreamService] continueOutreach - found leads", {
      leadCount: leadIds.length,
      leadIds: leadIds.slice(0, 5), // Log first 5 for debugging
    });

    if (leadIds.length === 0) {
      // No more leads without messages - send completion event
      console.log("[ChatAiStreamService] continueOutreach - no more leads, sending completion event");
      this.realtimeHub.broadcast(input.threadId, {
        type: "outreach.completed",
        payload: {
          message: "All leads in the directory have been contacted",
          directoryId: input.directoryId,
        },
      });
      return;
    }

    // Get the first lead (the next one to contact)
    const nextLeadId = leadIds[0];

    if (!nextLeadId) {
      console.log("[ChatAiStreamService] continueOutreach - no nextLeadId found");
      return;
    }

    console.log("[ChatAiStreamService] continueOutreach - processing next lead", {
      nextLeadId,
      remainingLeads: leadIds.length - 1,
    });

    // Notify that we're continuing to next lead
    this.realtimeHub.broadcast(input.threadId, {
      type: "outreach.continuing",
      payload: {
        nextLeadId,
        remainingLeads: leadIds.length - 1,
        directoryId: input.directoryId,
      },
    });

    console.log("[ChatAiStreamService] continueOutreach - calling streamAssistantReply", {
      hasContextFromFrontend: !!input.outreachContext,
      contextFields: input.outreachContext ? Object.keys(input.outreachContext) : [],
    });

    // Trigger AI stream for this lead with outreach context
    // Use context from frontend (first apply) or defaults
    await this.streamAssistantReply({
      userId: input.userId,
      threadId: input.threadId,
      text: input.outreachContext?.userPrompt ?? "", // Use saved userPrompt or empty
      clientMessageId: undefined,
      mode: ChatMode.CHAT_MODE_OUTREACH,
      outreachContext: {
        leadId: nextLeadId,
        directoryIds: [input.directoryId],
        // Preserve context from first apply:
        channel: input.outreachContext?.channel,
        stage: input.outreachContext?.stage,
        dayInSequence: input.outreachContext?.dayInSequence,
        followUpNumber: input.outreachContext?.followUpNumber,
        suggestedTactic: input.outreachContext?.suggestedTactic,
        customInstructions: input.outreachContext?.customInstructions,
        userPrompt: input.outreachContext?.userPrompt,
      },
    });

    console.log("[ChatAiStreamService] continueOutreach - completed");
  }
}
