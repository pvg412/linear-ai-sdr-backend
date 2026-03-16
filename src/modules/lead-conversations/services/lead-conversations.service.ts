import { inject, injectable } from "inversify";
import { MessageSender, UserRole } from "@prisma/client";

import { LEAD_CONVERSATIONS_TYPES } from "../lead-conversations.types";
import type { LeadConversationsRepository } from "../persistence/lead-conversations.repository";

import type {
  CreateConversationMessageDto,
  CreateLeadMessageDto,
  SaveCustomMessageDto,
  GetConversationHistoryQueryDto,
  ConversationHistoryResponse,
  ConversationMessageResponse,
} from "../schemas/lead-conversations.schemas";

import { UserFacingError } from "@/infra/userFacingError";
import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";
import { getPrisma } from "@/infra/prisma";
import { buildLeadVisibilityWhere } from "@/modules/lead/lead-visibility";

export interface SaveAcceptedMessageInput extends CreateConversationMessageDto {
  userId: string;
  userRole: string;
  userCompanyId?: string | null;
}

export interface SaveCustomMessageInput extends SaveCustomMessageDto {
  userId: string;
  userRole: string;
  userCompanyId?: string | null;
}

export interface SaveLeadMessageInput extends CreateLeadMessageDto {
  userId: string;
  userRole: string;
  userCompanyId?: string | null;
}

export interface DeleteMessageInput {
  messageId: string;
  userId: string;
  userRole: UserRole;
}

export interface GetHistoryInput extends GetConversationHistoryQueryDto {
  requestingUserId: string;
  requestingUserRole: UserRole;
  requestingUserCompanyId?: string | null;
}

@injectable()
export class LeadConversationsService {
  constructor(
    @inject(LEAD_CONVERSATIONS_TYPES.LeadConversationsRepository)
    private readonly repository: LeadConversationsRepository,
    @inject(REALTIME_TYPES.RealtimeHub)
    private readonly realtimeHub: RealtimeHub,
  ) { }

  /**
   * Verify the requesting user has visibility into the given lead.
   * Throws FORBIDDEN if the lead does not belong to the user's company.
   * ADMIN users can access any lead.
   */
  private async assertLeadVisible(
    userId: string,
    role: string,
    companyId: string | null | undefined,
    leadId: string,
  ): Promise<void> {
    if (role === UserRole.ADMIN) return; // admins see all leads

    const prisma = getPrisma();
    const visibilityWhere = buildLeadVisibilityWhere({ ownerId: userId, role, companyId });

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, ...visibilityWhere },
      select: { id: true },
    });

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }
  }

  async saveAcceptedMessage(
    input: SaveAcceptedMessageInput,
  ): Promise<ConversationMessageResponse> {
    await this.assertLeadVisible(input.userId, input.userRole, input.userCompanyId, input.leadId);

    if (input.chatMessageId) {
      const existing =
        await this.repository.findByChatMessageId(input.chatMessageId);
      if (existing) {
        throw new UserFacingError({
          userMessage: "Message from this chat already saved",
          code: "CONFLICT",
        });
      }
    }

    const message = await this.repository.createMessage({
      ...input,
      createdBy: input.userId,
      senderType: MessageSender.SALE_MANAGER,
    });

    // Emit WebSocket event to notify that message was saved
    // This will trigger continuation of outreach to next lead
    if (input.chatMessageId) {
      const threadId = await this.repository.getThreadIdByChatMessageId(
        input.chatMessageId,
      );
      if (threadId) {
        this.realtimeHub.broadcast(threadId, {
          type: "outreach.message_saved",
          payload: {
            leadId: input.leadId,
            messageId: message.id,
            chatMessageId: input.chatMessageId,
          },
        });
      }
    }

    return message;
  }

  /**
   * Save custom (edited) outreach message from sale manager
   */
  async saveCustomMessage(
    input: SaveCustomMessageInput,
  ): Promise<ConversationMessageResponse> {
    await this.assertLeadVisible(input.userId, input.userRole, input.userCompanyId, input.leadId);

    const existing = await this.repository.findByChatMessageId(
      input.chatMessageId,
    );
    if (existing) {
      throw new UserFacingError({
        userMessage: "Custom message already saved",
        code: "CONFLICT",
      });
    }

    const message = await this.repository.createMessage({
      leadId: input.leadId,
      createdBy: input.userId,
      senderType: MessageSender.SALE_MANAGER,
      channel: input.channel,
      stage: input.stage,
      subject: input.subject,
      body: input.body,
      chatMessageId: input.chatMessageId,
      sentAt: input.sentAt,
      characterCount: undefined,
      wordCount: undefined,
      usageNote: undefined,
      tacticUsed: undefined,
    });

    return message;
  }

  /**
   * Save lead's reply message
   */
  async saveLeadMessage(
    input: SaveLeadMessageInput,
  ): Promise<ConversationMessageResponse> {
    await this.assertLeadVisible(input.userId, input.userRole, input.userCompanyId, input.leadId);

    const message = await this.repository.createMessage({
      leadId: input.leadId,
      createdBy: input.userId,
      senderType: MessageSender.LEAD,
      channel: input.channel,
      stage: undefined,
      subject: input.subject,
      body: input.body,
      repliedAt: input.repliedAt,
      characterCount: undefined,
      wordCount: undefined,
      usageNote: undefined,
      tacticUsed: undefined,
      chatMessageId: undefined,
      sentAt: undefined,
    });

    return message;
  }

  async getConversationHistory(
    input: GetHistoryInput,
  ): Promise<ConversationHistoryResponse> {
    await this.assertLeadVisible(
      input.requestingUserId,
      input.requestingUserRole,
      input.requestingUserCompanyId,
      input.leadId,
    );

    const { messages, total } = await this.repository.findByLeadId({
      leadId: input.leadId,
      limit: input.limit,
      offset: input.offset,
    });

    return {
      messages,
      total,
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    };
  }

  async deleteMessage(input: DeleteMessageInput): Promise<void> {
    const message = await this.repository.findById(input.messageId);

    if (!message) {
      throw new UserFacingError({
        userMessage: "Message not found",
        code: "NOT_FOUND",
      });
    }

    const isCreator = message.createdBy === input.userId;
    const isAdmin = input.userRole === UserRole.ADMIN;

    if (!isCreator && !isAdmin) {
      throw new UserFacingError({
        userMessage: "You can only delete messages you created",
        code: "FORBIDDEN",
      });
    }

    await this.repository.deleteMessage(input.messageId);
  }

  async getMessageById(
    messageId: string,
  ): Promise<ConversationMessageResponse> {
    const message = await this.repository.findById(messageId);

    if (!message) {
      throw new UserFacingError({
        userMessage: "Message not found",
        code: "NOT_FOUND",
      });
    }

    return message;
  }

  async getMessageCount(leadId: string): Promise<number> {
    return this.repository.countByLeadId(leadId);
  }
}
