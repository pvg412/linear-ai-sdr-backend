import { inject, injectable } from "inversify";

import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import {
	LeadSearchRepository,
	type LeadSearchSelectorRow,
} from "@/modules/lead-search/persistence/lead-search.repository";

export type LeadSearchSelectorItem = {
	id: string;
	label: string;
	leadsCount: number;
	createdAt: Date;
	provider: string;
	kind: string;
	status: string;
};

@injectable()
export class LeadSearchQueryService {
	constructor(
		@inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
		private readonly leadSearchRepository: LeadSearchRepository
	) {}

	async listForSelector(userId: string): Promise<{ items: LeadSearchSelectorItem[] }> {
		const rows: LeadSearchSelectorRow[] =
			await this.leadSearchRepository.listForSelector(userId);

		const items: LeadSearchSelectorItem[] = rows.map((r) => {
			const label =
				(r.thread?.title?.trim() ? r.thread.title.trim() : null) ||
				(r.prompt?.trim() ? r.prompt.trim() : null) ||
				`${r.provider} ${r.kind}`;

			return {
				id: r.id,
				label,
				leadsCount: r._count.leads,
				createdAt: r.createdAt,
				provider: r.provider,
				kind: r.kind,
				status: r.status,
			};
		});

		return { items };
	}
}


