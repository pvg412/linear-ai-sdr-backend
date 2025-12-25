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

	async listLeads(
		userId: string,
		opts: {
			page?: number;
			perPage?: number;
			filters?: LeadPaginationFilters;
		}
	) {
		const prisma = getPrisma();

		const user = await prisma.user.findUnique({
			where: { id: userId },
		});

		if (!user) {
			throw new UserFacingError({
				code: "NOT_FOUND",
				userMessage: "User not found",
			});
		}

		return this.leadRepository.listLeads(opts);
	}
}
