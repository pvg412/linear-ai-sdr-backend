import {
  ChatMessageRole,
  ChatMessageType,
  LeadProvider,
  LeadSearchKind,
  Prisma,
} from "@prisma/client";
import type { z } from "zod";

import type {
  ChatThreadCreateSchema,
  ChatThreadPatchSchema,
  ChatSendMessageSchema,
  ChatApplyJsonSchema,
} from "../schemas/chat.schemas";

export type ChatThreadCreateDto = z.infer<typeof ChatThreadCreateSchema>;
export type ChatThreadPatchDto = z.infer<typeof ChatThreadPatchSchema>;

export type ChatSendMessageDto = z.infer<typeof ChatSendMessageSchema>;
export type ChatApplyJsonDto = z.infer<typeof ChatApplyJsonSchema>;

export interface OutreachContext {
  channel: string;
  stage: string;
  dayInSequence?: number;
  followUpNumber?: number;
  suggestedTactic?: string;
  leadResponseType?: string;
  customInstructions?: string;
  leadId?: string;
  directoryId?: string;
  userPrompt?: string;
}

export interface ParseOutreachPromptDto {
  text: string;
  directoryId: string;
  suggestedChannel?: string;
}

export interface ApplyOutreachContextDto {
  context: OutreachContext;
  parsedMessageId?: string;
  defaultDirectoryIds?: string[];
}

export interface ChatPromptParser {
  parsePrompt(input: {
    text: string;
    provider: LeadProvider;
    kind: LeadSearchKind;
  }): Promise<{
    /**
     * Provider/capability-specific query payload that will be shown to the user.
     * Must be JSON-serializable.
     */
    query: Record<string, unknown>;
    /**
     * Optional suggested limit (UI can override).
     */
    suggestedLimit?: number;
  }>;

  parseOutreachContext(input: {
    text: string;
    userId: string;
    threadId: string;
    leadId: string;
    directoryId?: string;
    hasPreviousMessages?: boolean;
    previousMessagesCount?: number;
    lastLeadResponse?: string;
    suggestedChannel?: string;
    customInstructions?: string;
    debug?: boolean;
  }): Promise<{
    channel: string;
    stage: string;
    dayInSequence: number;
    followUpNumber: number;
    suggestedTactic: string;
    leadId: string;
    directoryId?: string;
    warnings?: Array<{ code: string; message: string }>;
    usedFallbackJsonMode?: boolean;
    rawModelOutput?: string;
  }>;
}

export interface ChatMessageDto {
  id: string;
  threadId: string;

  role: ChatMessageRole;
  type: ChatMessageType;

  text: string | null;
  payload: Prisma.InputJsonValue | null;

  leadSearchId: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface SendMessageResultDto {
  userMessage: ChatMessageDto;
  assistantMessage: ChatMessageDto;
  parsed: {
    query: Record<string, unknown>;
    suggestedLimit?: number;
  };
}

export interface ApplyJsonResultDto {
  leadSearchId: string;
  userJsonMessage: ChatMessageDto;
  eventMessage: ChatMessageDto;
}

export interface ParseOutreachPromptResultDto {
  userMessage: ChatMessageDto;
  assistantMessage: ChatMessageDto;
  parsed: OutreachContext;
}

export interface ApplyOutreachContextResultDto {
  userJsonMessage: ChatMessageDto;
}
