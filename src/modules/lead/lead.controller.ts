import type { FastifyInstance } from "fastify";

import { container } from "@/container";
import { requireRequestUser } from "@/infra/auth/requestUser";

import { LEAD_TYPES } from "./lead.types";
import { LeadQueryService } from "./services/lead.query.service";
import { LeadPaginationSchema } from "./schemas/lead.schemas";

const leadQueryService = container.get<LeadQueryService>(
	LEAD_TYPES.LeadQueryService
);

export function registerLeadRoutes(app: FastifyInstance): void {
	app.post("/leads/search", async (req) => {
		const user = requireRequestUser(req);

		const q = LeadPaginationSchema.parse(req.body);

		return await leadQueryService.listLeads(user.id, {
			filters: q.filters,
			page: q.page,
			perPage: q.perPage,
		});
	});
}
