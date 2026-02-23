import { randomUUID } from "crypto";
import { inject, injectable } from "inversify";
import { MessageSender, OutreachChannel, OutreachStage, type PrismaClient, type Lead } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";
import { LEAD_CONVERSATIONS_TYPES } from "@/modules/lead-conversations/lead-conversations.types";
import type { LeadConversationsRepository } from "@/modules/lead-conversations/persistence/lead-conversations.repository";
import { OUTREACH_CONSTANTS } from "@/config/constants";

import type {
  ChatStreamRequest,
  OutreachContext as PbOutreachContext,
  OutreachMessage as PbOutreachMessage,
  ParseOutreachContextResponse,
} from "@/generated/aisdr/v1/ai_sdr";
import {
  ChatMessageRole as PbRole,
  ChatMessageType as PbType,
  ChatMode,
  LeadResponseType as PbLeadResponseType,
  OutreachChannel as PbOutreachChannel,
  OutreachStage as PbOutreachStage,
  outreachTacticToJSON,
} from "@/generated/aisdr/v1/ai_sdr";

import {
  getEventPayload,
  parseOutreachVariants,
  type OutreachVariantJson,
} from "@/modules/chat/services/stream";

import type { PipelineStepHandler } from "./step.interface";
import type {
  PipelineContext,
  PipelineStepResult,
  PipelineTools,
} from "@/modules/pipeline/schemas/pipeline.dto";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface OutreachDraftMessage {
  messageId: string;
  tactic: string;
  channel: string;
  stage: string;
  body: string;
  subject: string | null;
  characterCount: number;
  wordCount: number;
  usageNote: string | null;
}

interface OutreachDraft {
  leadId: string;
  fullName: string | null;
  messages: OutreachDraftMessage[];
}

/* ------------------------------------------------------------------ */
/*  Step                                                              */
/* ------------------------------------------------------------------ */

/**
 * Outreach step — generates outreach messages for each lead.
 *
 * Two-step AI flow per lead:
 *   1. ParseOutreachContext (unary gRPC)  — AI determines channel, stage, tactic
 *   2. ChatStream (streaming gRPC)        — AI generates message variants
 *
 * Results are saved to LeadConversationMessage (sentAt=null → pending).
 * The frontend displays the variants and the user picks which to send.
 */
@injectable()
export class OutreachStep implements PipelineStepHandler {
  readonly type = "outreach";
  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    private readonly aiGrpcClient: AiGrpcClient,
    @inject(LEAD_CONVERSATIONS_TYPES.LeadConversationsRepository)
    private readonly conversationsRepo: LeadConversationsRepository,
  ) {}

  /* ---------------------------------------------------------------- */
  /*  Main entry                                                      */
  /* ---------------------------------------------------------------- */

  async run(
    ctx: PipelineContext,
    config: Record<string, unknown>,
    tools: PipelineTools,
  ): Promise<PipelineStepResult> {
    const channel = (config.channel as string) ?? "linkedin";

    // ── Load active leads from PipelineRunLead ───────────────────────
    const runLeads = await this.prisma.pipelineRunLead.findMany({
      where: { pipelineRunId: ctx.pipelineRunId, excluded: false },
      include: { lead: true },
      orderBy: { createdAt: "asc" },
    });

    if (runLeads.length === 0) {
      tools.log.info(
        { pipelineRunId: ctx.pipelineRunId },
        "Outreach step: no leads to process",
      );
      tools.emitProgress("No leads to generate outreach for");
      return { outputSummary: { leadsProcessed: 0 } };
    }

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, leadCount: runLeads.length, channel },
      "Outreach step: starting message generation",
    );

    tools.emitProgress(
      `Generating outreach messages for ${runLeads.length} lead(s) via ${channel}`,
    );

    /* -- Process in batches ---------------------------------------- */
    const batchSize = OUTREACH_CONSTANTS.BATCH_SIZE;
    const outreachDrafts: OutreachDraft[] = [];
    let leadsSucceeded = 0;
    let leadsFailed = 0;
    let totalMessages = 0;
    let processed = 0;

    for (let i = 0; i < runLeads.length; i += batchSize) {
      if (await tools.checkCancelled()) {
        tools.log.info(
          { pipelineRunId: ctx.pipelineRunId },
          "Outreach step: cancelled",
        );
        break;
      }

      const batch = runLeads.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map((rl) =>
          this.processLead(rl.lead, ctx, channel, tools),
        ),
      );

      for (const result of batchResults) {
        if (result) {
          outreachDrafts.push(result);
          leadsSucceeded++;
          totalMessages += result.messages.length;
        } else {
          leadsFailed++;
        }
      }

      processed += batch.length;
      tools.emitProgress(
        `Generated messages for ${processed}/${runLeads.length} leads`,
      );
    }

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        leadsSucceeded,
        leadsFailed,
        totalMessages,
      },
      "Outreach step completed",
    );

    return {
      outputSummary: {
        leadsProcessed: runLeads.length,
        leadsSucceeded,
        leadsFailed,
        totalMessagesGenerated: totalMessages,
        channel,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Per-lead processing: Parse → Stream → Save                     */
  /* ---------------------------------------------------------------- */

  private async processLead(
    lead: Lead,
    ctx: PipelineContext,
    channel: string,
    tools: PipelineTools,
  ): Promise<OutreachDraft | null> {
    try {
      /* Step 1: Parse outreach context ----------------------------- */
      const parsed = await this.parseContext(lead, ctx, channel, tools);

      /* Step 2: Generate messages via ChatStream ------------------- */
      const variants = await this.generateMessages(
        lead,
        ctx,
        parsed,
        tools,
      );

      if (variants.length === 0) {
        tools.log.warn(
          { pipelineRunId: ctx.pipelineRunId, leadId: lead.id },
          "Outreach: AI returned no variants",
        );
        return null;
      }

      /* Step 3: Save to DB ----------------------------------------- */
      const savedMessages = await this.saveMessages(
        lead,
        ctx,
        variants,
        parsed,
        tools,
      );

      return {
        leadId: lead.id,
        fullName: lead.fullName ?? null,
        messages: savedMessages,
      };
    } catch (err) {
      tools.log.error(
        {
          pipelineRunId: ctx.pipelineRunId,
          leadId: lead.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "Outreach: failed to process lead",
      );
      return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Step 1: ParseOutreachContext (unary gRPC)                       */
  /* ---------------------------------------------------------------- */

  private async parseContext(
    lead: Lead,
    ctx: PipelineContext,
    channel: string,
    tools: PipelineTools,
  ): Promise<ParseOutreachContextResponse> {
    const suggestedChannel =
      channel.toUpperCase() === "LINKEDIN"
        ? PbOutreachChannel.OUTREACH_CHANNEL_LINKEDIN
        : PbOutreachChannel.OUTREACH_CHANNEL_EMAIL;

    tools.log.info(
      { pipelineRunId: ctx.pipelineRunId, leadId: lead.id },
      "Outreach: parsing context",
    );

    return this.aiGrpcClient.parseOutreachContext({
      requestId: "",
      userId: ctx.createdById,
      threadId: `pipeline-${ctx.pipelineRunId}`,
      workspaceId: ctx.createdById,
      leadId: lead.id,
      directoryId: "",
      text: "Generate a LinkedIn connection request message for this lead",
      hasPreviousMessages: false,
      previousMessagesCount: 0,
      lastLeadResponse: PbLeadResponseType.LEAD_RESPONSE_TYPE_NO_RESPONSE,
      previousMessages: [],
      suggestedChannel,
      debug: false,
      customInstructions: "",
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Step 2: ChatStream (streaming gRPC)                             */
  /* ---------------------------------------------------------------- */

  private async generateMessages(
    lead: Lead,
    ctx: PipelineContext,
    parsed: ParseOutreachContextResponse,
    tools: PipelineTools,
  ): Promise<OutreachVariantJson[]> {
    const requestId = randomUUID();

    /* Build outreach context from parse response */
    const outreachContext: PbOutreachContext = {
      channel: parsed.channel,
      stage: parsed.stage,
      dayInSequence: 0,
      followUpNumber: 0,
      suggestedTactic: parsed.suggestedTactic,
      leadResponseType: PbLeadResponseType.LEAD_RESPONSE_TYPE_NO_RESPONSE,
      leadLastReply: "",
      previousMessages: [],
      customInstructions: "",
      assetPermissionGranted: false,
      assetToSend: "",
    };

    const req: ChatStreamRequest = {
      requestId,
      workspaceId: ctx.createdById,
      threadId: `pipeline-${ctx.pipelineRunId}`,
      userId: ctx.createdById,
      userMessage: {
        messageId: randomUUID(),
        role: PbRole.CHAT_MESSAGE_ROLE_USER,
        type: PbType.CHAT_MESSAGE_TYPE_TEXT,
        text: "Generate a LinkedIn connection request message for this lead",
        createdAtMs: String(Date.now()),
      },
      history: [],
      context: { leadIds: [lead.id] },
      debug: false,
      mode: ChatMode.CHAT_MODE_OUTREACH,
      outreachContext,
    };

    tools.log.info(
      {
        pipelineRunId: ctx.pipelineRunId,
        leadId: lead.id,
        requestId,
        tactic: outreachTacticToJSON(parsed.suggestedTactic),
      },
      "Outreach: starting chatStream",
    );

    /* Consume the stream with a timeout */
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      OUTREACH_CONSTANTS.STREAM_TIMEOUT_MS,
    );

    try {
      let variants: OutreachVariantJson[] = [];

      for await (const ev of this.aiGrpcClient.chatStream(req, {
        signal: controller.signal,
      })) {
        const p = getEventPayload(ev);

        if (p.kind === "error" && p.data) {
          const errMsg =
            (p.data["message"] as string) ?? "Unknown AI error";
          throw new Error(`AI stream error: ${errMsg}`);
        }

        if (p.kind === "final" && p.data) {
          const outreachVariantsRaw = p.data["outreachVariants"];
          if (
            Array.isArray(outreachVariantsRaw) &&
            outreachVariantsRaw.length > 0
          ) {
            const parsed = parseOutreachVariants(
              outreachVariantsRaw as unknown as PbOutreachMessage[],
            );
            variants = parsed.outreachVariants;
          }
          break;
        }
      }

      return variants;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Step 3: Save variants to LeadConversationMessage                */
  /* ---------------------------------------------------------------- */

  private async saveMessages(
    lead: Lead,
    ctx: PipelineContext,
    variants: OutreachVariantJson[],
    parsed: ParseOutreachContextResponse,
    tools: PipelineTools,
  ): Promise<OutreachDraftMessage[]> {
    const savedMessages: OutreachDraftMessage[] = [];

    /* Map proto stage to Prisma enum */
    const prismaStage = this.mapParsedStageToPrisma(parsed.stage);

    /* Map proto channel to Prisma enum */
    const prismaChannel = this.mapParsedChannelToPrisma(parsed.channel);

    for (const variant of variants) {
      try {
        const msg = await this.conversationsRepo.createMessage({
          leadId: lead.id,
          channel: prismaChannel,
          stage: prismaStage,
          subject: variant.subject || undefined,
          body: variant.body,
          characterCount: variant.characterCount || undefined,
          wordCount: variant.wordCount || undefined,
          usageNote: variant.usageNote || undefined,
          tacticUsed: variant.tacticUsed || undefined,
          createdBy: ctx.createdById,
          senderType: MessageSender.SALE_MANAGER,
        });

        // Link the saved message to the pipeline run via junction table
        await this.conversationsRepo.linkToPipelineRun(
          msg.id,
          ctx.pipelineRunId,
        );

        savedMessages.push({
          messageId: msg.id,
          tactic: variant.tacticUsed ?? "UNSPECIFIED",
          channel: prismaChannel,
          stage: prismaStage ?? "UNSPECIFIED",
          body: variant.body,
          subject: variant.subject || null,
          characterCount: variant.characterCount,
          wordCount: variant.wordCount,
          usageNote: variant.usageNote ?? null,
        });
      } catch (err) {
        tools.log.error(
          {
            pipelineRunId: ctx.pipelineRunId,
            leadId: lead.id,
            tactic: variant.tacticUsed,
            err: err instanceof Error ? err.message : String(err),
          },
          "Outreach: failed to save message variant",
        );
      }
    }

    return savedMessages;
  }

  /* ---------------------------------------------------------------- */
  /*  Enum mapping helpers                                            */
  /* ---------------------------------------------------------------- */

  private mapParsedChannelToPrisma(
    channel: PbOutreachChannel,
  ): OutreachChannel {
    switch (channel) {
      case PbOutreachChannel.OUTREACH_CHANNEL_LINKEDIN:
        return OutreachChannel.LINKEDIN;
      case PbOutreachChannel.OUTREACH_CHANNEL_EMAIL:
        return OutreachChannel.EMAIL;
      default:
        return OutreachChannel.LINKEDIN;
    }
  }

  private mapParsedStageToPrisma(
    stage: PbOutreachStage,
  ): OutreachStage | undefined {
    const stageMap: Partial<Record<PbOutreachStage, OutreachStage>> = {
      [PbOutreachStage.OUTREACH_STAGE_CONNECTION_REQUEST]:
        OutreachStage.CONNECTION_REQUEST,
      [PbOutreachStage.OUTREACH_STAGE_POST_ACCEPT_FIRST_MESSAGE]:
        OutreachStage.POST_ACCEPT_FIRST_MESSAGE,
      [PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_1]:
        OutreachStage.LINKEDIN_FOLLOW_UP_1,
      [PbOutreachStage.OUTREACH_STAGE_LINKEDIN_FOLLOW_UP_2]:
        OutreachStage.LINKEDIN_FOLLOW_UP_2,
      [PbOutreachStage.OUTREACH_STAGE_LINKEDIN_CLOSE_LOOP]:
        OutreachStage.LINKEDIN_CLOSE_LOOP,
      [PbOutreachStage.OUTREACH_STAGE_COLD_EMAIL]:
        OutreachStage.COLD_EMAIL,
      [PbOutreachStage.OUTREACH_STAGE_WARM_EMAIL]:
        OutreachStage.WARM_EMAIL,
      [PbOutreachStage.OUTREACH_STAGE_INTRODUCTION_EMAIL]:
        OutreachStage.INTRODUCTION_EMAIL,
      [PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_1]:
        OutreachStage.EMAIL_FOLLOW_UP_1,
      [PbOutreachStage.OUTREACH_STAGE_EMAIL_FOLLOW_UP_2]:
        OutreachStage.EMAIL_FOLLOW_UP_2,
      [PbOutreachStage.OUTREACH_STAGE_EMAIL_CLOSE_LOOP]:
        OutreachStage.EMAIL_CLOSE_LOOP,
      [PbOutreachStage.OUTREACH_STAGE_FOLLOW_UP_NO_REPLY]:
        OutreachStage.FOLLOW_UP_NO_REPLY,
      [PbOutreachStage.OUTREACH_STAGE_AFTER_POSITIVE_REPLY]:
        OutreachStage.AFTER_POSITIVE_REPLY,
      [PbOutreachStage.OUTREACH_STAGE_REPLY_TO_QUESTION]:
        OutreachStage.REPLY_TO_QUESTION,
    };

    return stageMap[stage] ?? undefined;
  }
}
