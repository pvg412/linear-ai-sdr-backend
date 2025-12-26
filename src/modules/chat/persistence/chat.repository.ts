import { injectable } from "inversify";
import {
	ChatMessageRole,
	ChatMessageType,
	LeadProvider,
	LeadSearchKind,
	LeadSearchStatus,
	Prisma,
	PrismaClient,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";

type Json = Prisma.InputJsonValue;

function toIso(d: Date): string {
	return d.toISOString();
}

@injectable()
export class ChatRepository {
	private readonly prisma: PrismaClient = getPrisma();

	async listThreads(ownerId: string) {
		const rows = await this.prisma.chatThread.findMany({
			where: {
				ownerId,
			},
			orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
			select: {
				id: true,
				title: true,
				defaultProvider: true,
				defaultKind: true,
				lastMessageAt: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		return rows.map((x) => ({
			id: x.id,
			title: x.title,

			defaultProvider: x.defaultProvider ?? null,
			defaultKind: x.defaultKind ?? null,

			lastMessageAt: x.lastMessageAt ? toIso(x.lastMessageAt) : null,
			createdAt: toIso(x.createdAt),
			updatedAt: toIso(x.updatedAt),
		}));
	}

	async createThread(input: {
		ownerId: string;
		title?: string;
		defaultProvider?: LeadProvider;
		defaultKind?: LeadSearchKind;
	}) {
		const row = await this.prisma.chatThread.create({
			data: {
				ownerId: input.ownerId,
				title: input.title ?? null,
				defaultProvider: input.defaultProvider ?? null,
				defaultKind: input.defaultKind ?? null,
			},
		});

		return {
			id: row.id,
			title: row.title,
			defaultProvider: row.defaultProvider ?? null,
			defaultKind: row.defaultKind ?? null,
			lastMessageAt: row.lastMessageAt ? toIso(row.lastMessageAt) : null,
			createdAt: toIso(row.createdAt),
			updatedAt: toIso(row.updatedAt),
		};
	}

	async getThread(ownerId: string, threadId: string) {
		const row = await this.prisma.chatThread.findFirst({
			where: { id: threadId, ownerId },
		});

		if (!row) {
			throw new UserFacingError({
				code: "CHAT_THREAD_NOT_FOUND",
				userMessage: "Thread not found.",
			});
		}

		return {
			id: row.id,
			title: row.title,
			defaultProvider: row.defaultProvider ?? null,
			defaultKind: row.defaultKind ?? null,
			lastMessageAt: row.lastMessageAt ? toIso(row.lastMessageAt) : null,
			createdAt: toIso(row.createdAt),
			updatedAt: toIso(row.updatedAt),
		};
	}

	async patchThread(
		ownerId: string,
		threadId: string,
		patch: {
			title?: string | null;
			defaultProvider?: LeadProvider | null;
			defaultKind?: LeadSearchKind | null;
		}
	) {
		const updated = await this.prisma.chatThread.updateMany({
			where: { id: threadId, ownerId },
			data: {
				...(patch.title !== undefined ? { title: patch.title } : {}),
				...(patch.defaultProvider !== undefined
					? { defaultProvider: patch.defaultProvider }
					: {}),
				...(patch.defaultKind !== undefined
					? { defaultKind: patch.defaultKind }
					: {}),
			},
		});

		if (updated.count === 0) {
			throw new UserFacingError({
				code: "CHAT_THREAD_NOT_FOUND",
				userMessage: "Thread not found.",
			});
		}

		return this.getThread(ownerId, threadId);
	}

	async deleteThread(ownerId: string, threadId: string) {
		const deleted = await this.prisma.chatThread.deleteMany({
			where: { id: threadId, ownerId },
		});

		if (deleted.count === 0) {
			throw new UserFacingError({
				code: "CHAT_THREAD_NOT_FOUND",
				userMessage: "Thread not found.",
			});
		}

		return { ok: true as const };
	}

	async listMessages(
		ownerId: string,
		threadId: string,
		opts: { limit: number; cursor?: string }
	) {
		await this.assertThreadOwner(ownerId, threadId);

		const rows = await this.prisma.chatMessage.findMany({
			where: { threadId },
			orderBy: { createdAt: "asc" },
			take: opts.limit,
			...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
			select: {
				id: true,
				threadId: true,
				role: true,
				type: true,
				text: true,
				payload: true,
				leadSearchId: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		return rows.map((x) => ({
			id: x.id,
			threadId: x.threadId,
			role: x.role,
			type: x.type,
			text: x.text ?? null,
			payload: (x.payload ?? null) as Json | null,
			leadSearchId: x.leadSearchId ?? null,
			createdAt: toIso(x.createdAt),
			updatedAt: toIso(x.updatedAt),
		}));
	}

	async createMessage(input: {
		ownerId: string;
		threadId: string;
		role: ChatMessageRole;
		type: ChatMessageType;
		text?: string | null;
		payload?: Json | null;
		authorUserId?: string | null;
		leadSearchId?: string | null;
	}) {
		await this.assertThreadOwner(input.ownerId, input.threadId);

		let payload:
			| Prisma.InputJsonValue
			| Prisma.NullableJsonNullValueInput
			| undefined;
		if (input.payload === undefined) {
			payload = undefined;
		} else if (input.payload === null) {
			payload = Prisma.DbNull;
		} else {
			payload = input.payload;
		}

		const row = await this.prisma.chatMessage.create({
			data: {
				threadId: input.threadId,
				role: input.role,
				type: input.type,
				text: input.text ?? null,
				payload,
				authorUserId: input.authorUserId ?? null,
				leadSearchId: input.leadSearchId ?? null,
			},
			select: {
				id: true,
				threadId: true,
				role: true,
				type: true,
				text: true,
				payload: true,
				leadSearchId: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		await this.prisma.chatThread.update({
			where: { id: input.threadId },
			data: { lastMessageAt: new Date() },
		});

		return {
			id: row.id,
			threadId: row.threadId,
			role: row.role,
			type: row.type,
			text: row.text ?? null,
			payload: (row.payload ?? null) as Json | null,
			leadSearchId: row.leadSearchId ?? null,
			createdAt: toIso(row.createdAt),
			updatedAt: toIso(row.updatedAt),
		};
	}

	async createLeadSearchFromChat(input: {
		createdById: string;
		threadId: string;
		provider: LeadProvider;
		kind: LeadSearchKind;
		query: Json;
		limit: number;
	}): Promise<{ id: string }> {
		await this.assertThreadOwner(input.createdById, input.threadId);

		// Ensure capability row exists (composite PK [provider, kind])
		await this.prisma.leadProviderCapability.upsert({
			where: {
				provider_kind: {
					provider: input.provider,
					kind: input.kind,
				},
			},
			create: {
				provider: input.provider,
				kind: input.kind,
				label: null,
				description: null,
			},
			update: {},
		});

		const row = await this.prisma.leadSearch.create({
			data: {
				createdById: input.createdById,
				provider: input.provider,
				kind: input.kind,

				threadId: input.threadId,

				prompt: null,
				query: input.query,
				limit: input.limit,

				status: LeadSearchStatus.PENDING,
			},
			select: { id: true },
		});

		return { id: row.id };
	}

	private async assertThreadOwner(
		ownerId: string,
		threadId: string
	): Promise<void> {
		const row = await this.prisma.chatThread.findFirst({
			where: { id: threadId, ownerId },
			select: { id: true },
		});

		if (!row) {
			throw new UserFacingError({
				code: "CHAT_THREAD_NOT_FOUND",
				userMessage: "Thread not found.",
			});
		}
	}
}
