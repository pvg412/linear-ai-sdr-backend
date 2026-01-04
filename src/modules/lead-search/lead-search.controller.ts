import type { FastifyInstance } from "fastify";

import { container } from "@/container";
import { requireRequestUserId } from "@/infra/auth/requestUser";

import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchQueryService } from "@/modules/lead-search/services/lead-search.query.service";

export function registerLeadSearchRoutes(app: FastifyInstance): void {
	const qry = container.get<LeadSearchQueryService>(
		LEAD_SEARCH_TYPES.LeadSearchQueryService
	);

	app.get("/lead-searches/flat", async (req) => {
		const userId = requireRequestUserId(req);
		return await qry.listForSelector(userId);
	});
}


