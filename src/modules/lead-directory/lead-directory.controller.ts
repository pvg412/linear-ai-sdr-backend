import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { container } from "@/container";
import { ensureLogger } from "@/infra/observability";

import { LEAD_DIRECTORY_TYPES } from "./lead-directory.types";
import { LeadDirectoryCommandService } from "./services/lead-directory.command.service";
import { LeadDirectoryQueryService } from "./services/lead-directory.query.service";
import { LeadDirectoryError } from "./lead-directory.errors";
import {
	AddLeadToDirectoryBodySchema,
	CreateLeadDirectoryBodySchema,
	ListDirectoriesQuerySchema,
	ListDirectoryLeadsQuerySchema,
	MoveLeadDirectoryBodySchema,
	UpdateLeadDirectoryBodySchema,
} from "./schemas/lead-directory.schemas";
import { requireRequestUserId } from "@/infra/auth/requestUser";

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		throw new LeadDirectoryError(
			"VALIDATION",
			"Invalid request payload",
			parsed.error.flatten()
		);
	}
	return parsed.data;
}

function handleError(reply: FastifyReply, err: unknown) {
	if (err instanceof LeadDirectoryError) {
		const codeMap: Record<string, number> = {
			VALIDATION: 400,
			NOT_FOUND: 404,
			FORBIDDEN: 403,
			CONFLICT: 409,
		};
		const code = codeMap[err.code] ?? 400;

		return reply.code(code).send({
			error: err.code,
			message: err.message,
			details: err.details ?? null,
		});
	}

	return reply.code(500).send({
		error: "INTERNAL",
		message: err instanceof Error ? err.message : String(err),
	});
}

export function registerLeadDirectoryRoutes(app: FastifyInstance) {
	const cmd = container.get<LeadDirectoryCommandService>(
		LEAD_DIRECTORY_TYPES.LeadDirectoryCommandService
	);
	const qry = container.get<LeadDirectoryQueryService>(
		LEAD_DIRECTORY_TYPES.LeadDirectoryQueryService
	);

	const lg = ensureLogger();

	app.post("/lead-directories", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const body = parseOrThrow(CreateLeadDirectoryBodySchema, req.body);

			const created = await cmd.createDirectory(
				userId,
				{
					name: body.name,
					parentId: body.parentId ?? null,
					description: body.description ?? null,
					position: body.position,
				},
				lg
			);

			return reply.code(201).send({ directory: created });
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.get("/lead-directories", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const q = parseOrThrow(ListDirectoriesQuerySchema, req.query);

			const treeFlag = q.tree === "1" || q.tree === "true";

			if (treeFlag) {
				const tree = await qry.getTree(userId);
				return reply.send({ tree });
			}

			const parentId = q.parentId ?? null;
			const items = await qry.listChildren(userId, parentId, lg);
			return reply.send({ items, parentId });
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.get("/lead-directories/:directoryId", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const params = req.params as { directoryId: string };

			const dir = await qry.getDirectory(userId, params.directoryId);
			return reply.send({ directory: dir });
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.patch("/lead-directories/:directoryId", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const params = req.params as { directoryId: string };
			const body = parseOrThrow(UpdateLeadDirectoryBodySchema, req.body);

			const updated = await cmd.updateDirectory(
				userId,
				params.directoryId,
				body,
				lg
			);
			return reply.send({ directory: updated });
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.post("/lead-directories/:directoryId/move", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const params = req.params as { directoryId: string };
			const body = parseOrThrow(MoveLeadDirectoryBodySchema, req.body);

			const updated = await cmd.moveDirectory(
				userId,
				params.directoryId,
				body.parentId,
				lg
			);
			return reply.send({ directory: updated });
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.delete("/lead-directories/:directoryId", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const params = req.params as { directoryId: string };

			await cmd.deleteDirectory(userId, params.directoryId, lg);
			return reply.code(204).send();
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.post("/lead-directories/:directoryId/leads", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const params = req.params as { directoryId: string };
			const body = parseOrThrow(AddLeadToDirectoryBodySchema, req.body);

			await cmd.addLead(userId, params.directoryId, body.leadId, lg);
			return reply.code(204).send();
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.delete(
		"/lead-directories/:directoryId/leads/:leadId",
		async (req, reply) => {
			try {
				const userId = requireRequestUserId(req);
				const params = req.params as { directoryId: string; leadId: string };

				await cmd.removeLead(userId, params.directoryId, params.leadId, lg);
				return reply.code(204).send();
			} catch (err) {
				return handleError(reply, err);
			}
		}
	);

	app.get("/lead-directories/:directoryId/leads", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const params = req.params as { directoryId: string };
			const q = parseOrThrow(ListDirectoryLeadsQuerySchema, req.query);

			const res = await qry.listLeads(userId, params.directoryId, {
				limit: q.limit,
				offset: q.offset,
			});
			return reply.send({
				total: res.total,
				items: res.items,
				limit: q.limit,
				offset: q.offset,
			});
		} catch (err) {
			return handleError(reply, err);
		}
	});

	app.get("/leads/:leadId/directories", async (req, reply) => {
		try {
			const userId = requireRequestUserId(req);
			const params = req.params as { leadId: string };

			const items = await qry.listDirectoriesForLead(userId, params.leadId);
			return reply.send({ items });
		} catch (err) {
			return handleError(reply, err);
		}
	});

	lg.info({}, "LeadDirectory controller registered");
}
