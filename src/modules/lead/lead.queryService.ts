import { inject, injectable } from "inversify";
import { LeadStatus } from "@prisma/client";

import { LEAD_TYPES } from "./lead.types";
import { LeadRepository } from "./lead.repository";
import { GetLeadByIdResponse, GetLeadsByTaskResponse } from "./lead.dto";

@injectable()
export class LeadQueryService {
	constructor(
		@inject(LEAD_TYPES.LeadRepository)
		private readonly leadRepository: LeadRepository
	) {}

	async getById(id: string): Promise<GetLeadByIdResponse> {
		return this.leadRepository.findById(id);
	}

	async getBySearchTaskId(
		searchTaskId: string,
		options: {
			status?: LeadStatus;
			limit?: number;
			offset?: number;
		} = {}
	): Promise<GetLeadsByTaskResponse> {
		return this.leadRepository.findBySearchTaskId(searchTaskId, {
			status: options.status,
			limit: options.limit ?? 100,
			offset: options.offset ?? 0,
		});
	}
}
