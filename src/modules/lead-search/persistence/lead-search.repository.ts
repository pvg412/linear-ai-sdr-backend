import { injectable } from "inversify";
import { LeadSearchStatus, Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class LeadSearchRepository {
	private readonly prisma: PrismaClient = getPrisma();

	getById(id: string) {
		return this.prisma.leadSearch.findUnique({
			where: { id },
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
