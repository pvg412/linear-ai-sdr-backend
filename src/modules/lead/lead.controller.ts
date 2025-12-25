import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";

import { container } from "@/container";
import { requireRequestUser } from "@/infra/auth/requestUser";

import { LEAD_TYPES } from "./lead.types";
import { LeadQueryService } from "./lead.query.service";
import { LeadPaginationSchema } from "./lead.schemas";

const leadQueryService = container.get<LeadQueryService>(
	LEAD_TYPES.LeadQueryService
);

export function registerLeadRoutes(app: FastifyInstance): void {
	app.get("/leads", async (req) => {
		const user = requireRequestUser(req);

		const q = LeadPaginationSchema.parse(req.query);

		return leadQueryService.listLeads(user.id, user.role as UserRole, {
			leadSearchId: q.leadSearchId,
			page: q.page,
			perPage: q.perPage,
		});
	});
}
