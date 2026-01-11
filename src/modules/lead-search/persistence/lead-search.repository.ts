import { injectable } from "inversify";
import { LeadSearchStatus, Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

export type LeadSearchSelectorRow = {
	id: string;
	createdAt: Date;
	prompt: string | null;
	provider: string;
	kind: string;
	status: string;
	thread: { title: string | null } | null;
	_count: { leads: number };
};

export function buildLeadSearchSelectorWhere(userId: string): Prisma.LeadSearchWhereInput {
	return {
		createdById: userId,
		// Exclude LeadSearch records that have 0 leads in the join table
		leads: { some: {} },
	};
}

@injectable()
export class LeadSearchRepository {
	private readonly prisma: PrismaClient = getPrisma();

	getById(id: string) {
		return this.prisma.leadSearch.findUnique({
			where: { id },
		});
	}

	async listForSelector(userId: string): Promise<LeadSearchSelectorRow[]> {
		const rows = await this.prisma.leadSearch.findMany({
			where: buildLeadSearchSelectorWhere(userId),
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				createdAt: true,
				prompt: true,
				provider: true,
				kind: true,
				status: true,
				thread: { select: { title: true } },
				_count: { select: { leads: true } },
			},
		});
		// Prisma types can become `any` in some tooling contexts; keep controller/service strict.
		return rows as unknown as LeadSearchSelectorRow[];
	}

	async findRunningSearches() {
		return this.prisma.leadSearch.findMany({
			where: {
				status: LeadSearchStatus.RUNNING,
			},
			orderBy: { createdAt: "asc" },
		});
	}

	async markRunning(id: string): Promise<void> {
		await this.prisma.leadSearch.update({
			where: { id },
			data: {
				status: LeadSearchStatus.RUNNING,
				errorMessage: null,
			},
		});
	}

	async markDone(id: string, totalLeads: number): Promise<void> {
		await this.prisma.leadSearch.update({
			where: { id },
			data: {
				status:
					totalLeads > 0
						? LeadSearchStatus.DONE
						: LeadSearchStatus.DONE_NO_RESULTS,
				totalLeads,
				errorMessage: null,
			},
		});
	}

	async markFailed(id: string, errorMessage: string): Promise<void> {
		await this.prisma.leadSearch.update({
			where: { id },
			data: {
				status: LeadSearchStatus.FAILED,
				errorMessage,
			},
		});
	}

	async updateQuery(id: string, query: Prisma.InputJsonValue): Promise<void> {
		await this.prisma.leadSearch.update({
			where: { id },
			data: { query },
		});
	}
}
