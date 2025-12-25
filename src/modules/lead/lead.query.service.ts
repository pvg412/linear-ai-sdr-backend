import { inject, injectable } from "inversify";
import { UserRole } from "@prisma/client";

import { LEAD_TYPES } from "./lead.types";
import { LeadRepository } from "./lead.repository";

@injectable()
export class LeadQueryService {
	constructor(
		@inject(LEAD_TYPES.LeadRepository)
		private readonly leadRepository: LeadRepository
	) {}

	listLeads(
		userId: string,
		role: UserRole,
		opts: {
			cursor?: string;
			leadSearchId?: string;
			page?: number;
			perPage?: number;
		}
	) {
		return this.leadRepository.listLeads(userId, role, opts);
	}
}
