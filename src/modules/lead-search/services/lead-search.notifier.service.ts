import { inject, injectable } from "inversify";
import {
	ChatMessageRole,
	ChatMessageType,
	LeadProvider,
	Prisma,
	PrismaClient,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";

import {
	resolveParserIdFromProvider,
	resolveParserLabelFromProvider,
} from "@/modules/chat/parsers/chat.parsers";

@injectable()
export class LeadSearchNotifierService {
	private readonly prisma: PrismaClient = getPrisma();

	constructor(
		@inject(REALTIME_TYPES.RealtimeHub)
		private readonly realtimeHub: RealtimeHub
	) {}

	publicParserMeta(provider: LeadProvider): {
		parser: string;
		parserLabel?: string;
	} {
		const parser = resolveParserIdFromProvider(provider);
		const parserLabel = resolveParserLabelFromProvider(provider) ?? undefined;

		// IMPORTANT: never leak provider to frontend
		if (!parser) return { parser: "UNKNOWN" };
		return { parser, ...(parserLabel ? { parserLabel } : {}) };
	}

	async postEvent(args: {
		threadId: string | null;
		leadSearchId: string;
		text: string;
		payload: Record<string, unknown>;
	}): Promise<void> {
		if (!args.threadId) return;

		const message = await this.prisma.chatMessage.create({
			data: {
				threadId: args.threadId,
				role: ChatMessageRole.ASSISTANT,
				type: ChatMessageType.EVENT,
				text: args.text,
				payload: args.payload as Prisma.InputJsonValue,
				leadSearchId: args.leadSearchId,
				authorUserId: null,
			},
		});

		await this.prisma.chatThread.update({
			where: { id: args.threadId },
			data: { lastMessageAt: new Date() },
		});

		this.realtimeHub.broadcast(args.threadId, {
			type: "message.created",
			payload: { message },
		});
	}
}
