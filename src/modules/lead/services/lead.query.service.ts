import { inject, injectable } from "inversify";

import { LEAD_TYPES } from "../lead.types";
import { LeadRepository } from "../persistence/lead.repository";
import { LeadPaginationFilters } from "../schemas/lead.schemas";
import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";

@injectable()
export class LeadQueryService {
	constructor(
		@inject(LEAD_TYPES.LeadRepository)
		private readonly leadRepository: LeadRepository,
	) {}

	private async assertUserExists(userId: string): Promise<void> {
		const prisma = getPrisma();
		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) {
			throw new UserFacingError({
				code: "NOT_FOUND",
				userMessage: "User not found",
			});
		}
	}

	private async assertLeadSearchOwned(
		userId: string,
		leadSearchId: string
	): Promise<void> {
		const prisma = getPrisma();
		const owned = await prisma.leadSearch.findFirst({
			where: { id: leadSearchId, createdById: userId },
			select: { id: true },
		});
		if (!owned) {
			throw new UserFacingError({
				code: "FORBIDDEN",
				userMessage: "LeadSearch not found or not owned by user",
			});
		}
	}

	async listLeads(
		userId: string,
		opts: {
			page?: number;
			perPage?: number;
			filters?: LeadPaginationFilters;
		}
	) {
		await this.assertUserExists(userId);

		return this.leadRepository.listLeads({ ownerId: userId, ...opts });
	}

	async listLeadsForLeadSearchIncludingUnverified(
		userId: string,
		input: { leadSearchId: string; page: number; perPage: number }
	) {
		await this.assertUserExists(userId);
		await this.assertLeadSearchOwned(userId, input.leadSearchId);

		return this.leadRepository.listLeads({
			ownerId: userId,
			page: input.page,
			perPage: input.perPage,
			filters: { leadSearchId: input.leadSearchId },
			includeUnverified: true,
		});
	}
}
