import type { FastifyInstance, FastifyRequest } from "fastify";
import { UserRole } from "@prisma/client";

import { container } from "@/container";
import { UserFacingError } from "@/infra/userFacingError";

import { LEAD_TYPES } from "./lead.types";
import { LeadQueryService } from "./lead.query.service";
import { LeadPaginationSchema } from "./lead.schemas";

const leadQueryService = container.get<LeadQueryService>(
	LEAD_TYPES.LeadQueryService
);

function requireUser(req: FastifyRequest): { id: string; role: UserRole } {
	const userId = req.user?.id;
	const rawRole = req.user?.role;

	if (!userId || !rawRole) {
		throw new UserFacingError({
			code: "UNAUTHORIZED",
			userMessage: "Unauthorized.",
		});
	}

	let role: UserRole | null = null;
	if (rawRole === UserRole.ADMIN) {
		role = UserRole.ADMIN;
	} else if (rawRole === UserRole.SALE_MANAGER) {
		role = UserRole.SALE_MANAGER;
	}

	if (!role) {
		throw new UserFacingError({
			code: "UNAUTHORIZED",
			userMessage: "Unauthorized.",
		});
	}

	return { id: userId, role };
}

export function registerLeadRoutes(app: FastifyInstance): void {
	app.get("/leads", async (req) => {
		const user = requireUser(req);
		const q = LeadPaginationSchema.parse(req.query);

		return leadQueryService.listLeads(user.id, user.role, {
			leadSearchId: q.leadSearchId,
			page: q.page,
			perPage: q.perPage,
		});
	});
}
