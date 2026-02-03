import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";

import { container } from "@/container";
import { requireRequestUser } from "@/infra/auth/requestUser";

import { LEAD_CONVERSATIONS_TYPES } from "../lead-conversations.types";
import { LeadConversationsService } from "../services/lead-conversations.service";

import {
  CreateConversationMessageSchema,
  CreateLeadMessageSchema,
  GetConversationHistoryQuerySchema,
  DeleteConversationMessageParamsSchema,
} from "../schemas/lead-conversations.schemas";

const leadConversationsService = container.get<LeadConversationsService>(
  LEAD_CONVERSATIONS_TYPES.LeadConversationsService,
);

export function registerLeadConversationsRoutes(app: FastifyInstance): void {
  /**
   * GET /lead-conversations/history
   * Get conversation history for a lead
   * Query params: leadId, limit, offset
   */
  app.get("/lead-conversations/history", async (req) => {
    const user = requireRequestUser(req);
    const query = GetConversationHistoryQuerySchema.parse(req.query);

    const result = await leadConversationsService.getConversationHistory({
      ...query,
      requestingUserId: user.id,
      requestingUserRole: user.role as UserRole,
    });

    return result;
  });

  /**
   * POST /lead-conversations/messages
   * Save selected outreach message from 3 variants (from sale manager)
   */
  app.post("/lead-conversations/messages", async (req, reply) => {
    const user = requireRequestUser(req);
    const body = CreateConversationMessageSchema.parse(req.body);

    const message = await leadConversationsService.saveAcceptedMessage({
      ...body,
      userId: user.id,
    });

    return reply.status(201).send(message);
  });

  /**
   * POST /lead-conversations/lead-messages
   * Save lead's reply message
   */
  app.post("/lead-conversations/lead-messages", async (req, reply) => {
    const user = requireRequestUser(req);
    const body = CreateLeadMessageSchema.parse(req.body);

    const message = await leadConversationsService.saveLeadMessage({
      ...body,
      userId: user.id,
    });

    return reply.status(201).send(message);
  });

  /**
   * DELETE /lead-conversations/messages/:messageId
   * Delete message (UNDO functionality)
   */
  app.delete("/lead-conversations/messages/:messageId", async (req, reply) => {
    const user = requireRequestUser(req);
    const params = DeleteConversationMessageParamsSchema.parse(req.params);

    await leadConversationsService.deleteMessage({
      messageId: params.messageId,
      userId: user.id,
      userRole: user.role as UserRole,
    });

    return reply.status(200).send({
      success: true,
      message: "Message deleted successfully",
    });
  });

  /**
   * GET /lead-conversations/messages/:messageId
   * Get single message by ID
   */
  app.get("/lead-conversations/messages/:messageId", async (req) => {
    requireRequestUser(req);
    const params = DeleteConversationMessageParamsSchema.parse(req.params);

    const message = await leadConversationsService.getMessageById(
      params.messageId,
    );

    return message;
  });
}
