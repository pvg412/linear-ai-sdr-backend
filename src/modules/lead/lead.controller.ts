import type { FastifyInstance } from "fastify";

import { container } from "@/container";
import { requireRequestUser } from "@/infra/auth/requestUser";

import { LEAD_TYPES } from "./lead.types";
import { LeadCommandService } from "./services/lead.command.service";
import { LeadQueryService } from "./services/lead.query.service";
import {
	LeadPaginationSchema,
	LeadSearchIdParamsSchema,
	LeadSearchLeadsPaginationSchema,
	LeadSearchLeadsVerifySchema,
} from "./schemas/lead.schemas";

const leadQueryService = container.get<LeadQueryService>(
	LEAD_TYPES.LeadQueryService
);
const leadCommandService = container.get<LeadCommandService>(
	LEAD_TYPES.LeadCommandService
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

	// LeadSearch-scoped endpoint: returns ALL leads (including unverified) for moderation/verification.
	app.post("/lead-searches/:leadSearchId/leads", async (req) => {
		const user = requireRequestUser(req);

		const params = LeadSearchIdParamsSchema.parse(req.params);
		const body = LeadSearchLeadsPaginationSchema.parse(req.body);

		return await leadQueryService.listLeadsForLeadSearchIncludingUnverified(
			user.id,
			{
				leadSearchId: params.leadSearchId,
				page: body.page,
				perPage: body.perPage,
			}
		);
	});

	app.patch("/lead-searches/:leadSearchId/leads/verification", async (req) => {
		const user = requireRequestUser(req);

		const params = LeadSearchIdParamsSchema.parse(req.params);
		const body = LeadSearchLeadsVerifySchema.parse(req.body);

		return await leadCommandService.setLeadsVerificationForLeadSearch(user.id, {
			leadSearchId: params.leadSearchId,
			items: body.items,
		});
	});
}
