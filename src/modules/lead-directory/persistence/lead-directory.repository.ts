import { injectable } from "inversify";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

export type LeadDirectoryDto = {
	id: string;
	ownerId: string;
	parentId: string | null;
	name: string;
	description: string | null;
	position: number;
	createdAt: Date;
	updatedAt: Date;
	childrenCount: number;
	leadsCount: number;
};

export type LeadDirectoryTreeNodeDto = LeadDirectoryDto & {
	children: LeadDirectoryTreeNodeDto[];
};

function toDirectoryDto(
	row: Prisma.LeadDirectoryGetPayload<{
		include: { _count: { select: { children: true; leads: true } } };
	}>
): LeadDirectoryDto {
	return {
		id: row.id,
		ownerId: row.ownerId,
		parentId: row.parentId,
		name: row.name,
		description: row.description,
		position: row.position,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		childrenCount: row._count.children,
		leadsCount: row._count.leads,
	};
}

@injectable()
export class LeadDirectoryRepository {
	private readonly prisma: PrismaClient = getPrisma();

	async findOwnedById(input: {
		directoryId: string;
		ownerId: string;
	}): Promise<LeadDirectoryDto | null> {
		const row = await this.prisma.leadDirectory.findFirst({
			where: { id: input.directoryId, ownerId: input.ownerId },
			include: { _count: { select: { children: true, leads: true } } },
		});
		return row ? toDirectoryDto(row) : null;
	}

	async findOwnedParentId(input: {
		directoryId: string;
		ownerId: string;
	}): Promise<string | null> {
		const row = await this.prisma.leadDirectory.findFirst({
			where: { id: input.directoryId, ownerId: input.ownerId },
			select: { parentId: true },
		});
		return row?.parentId ?? null;
	}

	async listByParent(input: {
		ownerId: string;
		parentId: string | null;
	}): Promise<LeadDirectoryDto[]> {
		const rows = await this.prisma.leadDirectory.findMany({
			where: { ownerId: input.ownerId, parentId: input.parentId },
			orderBy: [{ position: "asc" }, { createdAt: "asc" }],
			include: { _count: { select: { children: true, leads: true } } },
		});
		return rows.map(toDirectoryDto);
	}

	async listAllForOwner(ownerId: string): Promise<LeadDirectoryDto[]> {
		const rows = await this.prisma.leadDirectory.findMany({
			where: { ownerId },
			orderBy: [{ parentId: "asc" }, { position: "asc" }, { createdAt: "asc" }],
			include: { _count: { select: { children: true, leads: true } } },
		});
		return rows.map(toDirectoryDto);
	}

	async create(input: {
		ownerId: string;
		name: string;
		parentId: string | null;
		description?: string | null;
		position?: number;
	}): Promise<LeadDirectoryDto> {
		const row = await this.prisma.leadDirectory.create({
			data: {
				ownerId: input.ownerId,
				name: input.name,
				parentId: input.parentId,
				description: input.description ?? null,
				position: input.position ?? 0,
			},
			include: { _count: { select: { children: true, leads: true } } },
		});
		return toDirectoryDto(row);
	}

	async updateOwned(input: {
		ownerId: string;
		directoryId: string;
		data: {
			name?: string;
			description?: string | null;
			position?: number;
			parentId?: string | null;
		};
	}): Promise<LeadDirectoryDto | null> {
		return this.prisma.$transaction(async (tx) => {
			const res = await tx.leadDirectory.updateMany({
				where: { id: input.directoryId, ownerId: input.ownerId },
				data: input.data,
			});

			if (res.count === 0) return null;

			const row = await tx.leadDirectory.findFirst({
				where: { id: input.directoryId, ownerId: input.ownerId },
				include: { _count: { select: { children: true, leads: true } } },
			});

			return row ? toDirectoryDto(row) : null;
		});
	}

	async deleteOwned(input: {
		ownerId: string;
		directoryId: string;
	}): Promise<boolean> {
		const res = await this.prisma.leadDirectory.deleteMany({
			where: { id: input.directoryId, ownerId: input.ownerId },
		});
		return res.count > 0;
	}

	async leadExists(leadId: string): Promise<boolean> {
		const row = await this.prisma.lead.findUnique({
			where: { id: leadId },
			select: { id: true },
		});
		return Boolean(row);
	}

	async addLeadToDirectory(input: {
		directoryId: string;
		leadId: string;
	}): Promise<void> {
		await this.prisma.leadDirectoryLead.upsert({
			where: {
				directoryId_leadId: {
					directoryId: input.directoryId,
					leadId: input.leadId,
				},
			},
			create: {
				directoryId: input.directoryId,
				leadId: input.leadId,
			},
			update: {},
		});
	}

	async removeLeadFromDirectory(input: {
		ownerId: string;
		directoryId: string;
		leadId: string;
	}): Promise<void> {
		await this.prisma.leadDirectoryLead.deleteMany({
			where: {
				directoryId: input.directoryId,
				leadId: input.leadId,
				directory: { ownerId: input.ownerId },
			},
		});
	}

	async listDirectoryLeads(input: {
		ownerId: string;
		directoryId: string;
		limit: number;
		offset: number;
	}): Promise<{ total: number; items: Prisma.LeadGetPayload<object>[] }> {
		const where = {
			directoryId: input.directoryId,
			directory: { ownerId: input.ownerId },
		} satisfies Prisma.LeadDirectoryLeadWhereInput;

		const [total, rows] = await this.prisma.$transaction([
			this.prisma.leadDirectoryLead.count({ where }),
			this.prisma.leadDirectoryLead.findMany({
				where,
				include: { lead: true },
				orderBy: { createdAt: "desc" },
				skip: input.offset,
				take: input.limit,
			}),
		]);

		return { total, items: rows.map((r) => r.lead) };
	}

	async countUnassignedLeads(input: { ownerId: string }): Promise<number> {
		// Unassigned = a lead not linked to any directory owned by this user.
		// We also scope to leads created by this user to avoid leaking data across users.
		return this.prisma.lead.count({
			where: {
				createdById: input.ownerId,
				leadDirectoryLeads: { none: { directory: { ownerId: input.ownerId } } },
			},
		});
	}

	async listUnassignedLeads(input: {
		ownerId: string;
		limit: number;
		offset: number;
	}): Promise<{ total: number; items: Prisma.LeadGetPayload<object>[] }> {
		const where = {
			createdById: input.ownerId,
			leadDirectoryLeads: { none: { directory: { ownerId: input.ownerId } } },
		} satisfies Prisma.LeadWhereInput;

		const [total, items] = await this.prisma.$transaction([
			this.prisma.lead.count({ where }),
			this.prisma.lead.findMany({
				where,
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				skip: input.offset,
				take: input.limit,
			}),
		]);

		return { total, items };
	}

	async listLeadDirectories(input: {
		ownerId: string;
		leadId: string;
	}): Promise<LeadDirectoryDto[]> {
		const rows = await this.prisma.leadDirectory.findMany({
			where: {
				ownerId: input.ownerId,
				leads: { some: { leadId: input.leadId } },
			},
			orderBy: [{ parentId: "asc" }, { position: "asc" }, { createdAt: "asc" }],
			include: { _count: { select: { children: true, leads: true } } },
		});

		return rows.map(toDirectoryDto);
	}
}
