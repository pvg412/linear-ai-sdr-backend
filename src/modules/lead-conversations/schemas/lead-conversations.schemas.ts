import { z } from "zod";
import {
  OutreachChannel,
  OutreachStage,
  MessageSender,
} from "@prisma/client";

export const CreateConversationMessageSchema = z.object({
  leadId: z.string().min(1),
  channel: z.enum(OutreachChannel),
  stage: z.enum(OutreachStage).optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
  characterCount: z.number().optional(),
  wordCount: z.number().optional(),
  usageNote: z.string().optional(),
  tacticUsed: z.string().optional(),
  chatMessageId: z.string().optional(),
  sentAt: z.coerce.date().optional(),
});

export type CreateConversationMessageDto = z.infer<
  typeof CreateConversationMessageSchema
>;

export const CreateLeadMessageSchema = z.object({
  leadId: z.string().min(1),
  channel: z.enum(OutreachChannel),
  subject: z.string().optional(),
  body: z.string().min(1),
  repliedAt: z.coerce.date().optional(),
});

export type CreateLeadMessageDto = z.infer<typeof CreateLeadMessageSchema>;

export const GetConversationHistoryQuerySchema = z.object({
  leadId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type GetConversationHistoryQueryDto = z.infer<
  typeof GetConversationHistoryQuerySchema
>;

export const DeleteConversationMessageParamsSchema = z.object({
  messageId: z.string().min(1),
});

export type DeleteConversationMessageParamsDto = z.infer<
  typeof DeleteConversationMessageParamsSchema
>;

export interface ConversationMessageResponse {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  leadId: string;
  createdBy: string | null;
  senderType: MessageSender;
  channel: OutreachChannel;
  stage: OutreachStage | null;
  subject: string | null;
  body: string;
  characterCount: number | null;
  wordCount: number | null;
  usageNote: string | null;
  tacticUsed: string | null;
  sentAt: Date | null;
  repliedAt: Date | null;
  chatMessageId: string | null;
}

export interface ConversationHistoryResponse {
  messages: ConversationMessageResponse[];
  total: number;
  limit: number;
  offset: number;
}
