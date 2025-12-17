import { inject, injectable } from "inversify";
import { LeadStatus, Prisma } from "@prisma/client";

import { LEAD_TYPES } from "./lead.types";
import { LeadRepository } from "./lead.repository";
import { BulkCreateLeadsBody } from "./lead.schemas";
import { BulkCreateLeadsResponse, UpdateLeadStatusResponse } from "./lead.dto";

@injectable()
export class LeadCommandService {
	constructor(
		@inject(LEAD_TYPES.LeadRepository)
		private readonly leadRepository: LeadRepository
	) {}

	async bulkCreateForSearchTask(
		body: BulkCreateLeadsBody
	): Promise<BulkCreateLeadsResponse> {
		const { searchTaskId, leads } = body;

		const normalizeOptional = (v?: string | null): string | undefined => {
			const trimmed = typeof v === "string" ? v.trim() : "";
			return trimmed ? trimmed : undefined;
		};

		const normalizeEmail = (v?: string | null): string | undefined => {
			const trimmed = normalizeOptional(v);
			return trimmed ? trimmed.toLowerCase() : undefined;
		};

		const normalizeUrl = (v?: string | null): string | undefined => {
			const trimmed = normalizeOptional(v);
			return trimmed ? trimmed.toLowerCase() : undefined;
		};

		const seen = new Set<string>();
		const data: Prisma.LeadCreateManyInput[] = [];

		for (const lead of leads) {
			const email = normalizeEmail(lead.email);
			const linkedinUrl = normalizeUrl(lead.linkedinUrl);
			const externalId = normalizeOptional(lead.externalId);

			const key = email
				? `email:${email}`
				: linkedinUrl
					? `linkedin:${linkedinUrl}`
					: externalId
						? `external:${lead.source}:${externalId}`
						: null;

			if (key && seen.has(key)) continue;
			if (key) seen.add(key);

			data.push({
				...lead,
				searchTaskId,
				email,
				linkedinUrl,
				externalId,
				raw: lead.raw as Prisma.InputJsonValue | undefined,
			});
		}

		if (!data.length) {
			return { count: 0 };
		}

		return this.leadRepository.createMany(data);
	}

	async updateStatus(
		id: string,
		status: LeadStatus
	): Promise<UpdateLeadStatusResponse> {
		return this.leadRepository.updateStatus(id, status);
	}
}
