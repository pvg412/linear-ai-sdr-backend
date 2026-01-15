import { inject, injectable } from "inversify";
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { getPrisma } from "@/infra/prisma";

import { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";

import type {
	DeleteLeadDocumentsRequest,
	UpsertLeadDocumentsRequest,
} from "@/generated/aisdr/v1/ai_sdr";
import { LeadDocumentKind } from "@/generated/aisdr/v1/ai_sdr";

import { UNASSIGNED_DIRECTORY_ID } from "@/modules/lead-directory/lead-directory.unassigned";
import { buildLeadVisibilityWhere } from "@/modules/lead/lead-visibility";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(
	obj: Record<string, unknown>,
	keys: string[]
): string | undefined {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === "string" && v.trim().length > 0) return v.trim();
	}
	return undefined;
}

function pickStringArray(
	obj: Record<string, unknown>,
	keys: string[]
): string[] {
	for (const k of keys) {
		const v = obj[k];
		if (Array.isArray(v)) {
			return v
				.filter((x) => typeof x === "string")
				.map((s) => s.trim())
				.filter(Boolean);
		}
	}
	return [];
}

function clampText(s: string, maxChars: number): string {
	if (s.length <= maxChars) return s;
	return s.slice(0, maxChars - 1) + "…";
}

function leadToRagText(lead: unknown): string {
	if (!isRecord(lead)) return "";

	const fullName =
		pickString(lead, ["fullName", "name"]) ??
		[pickString(lead, ["firstName"]), pickString(lead, ["lastName"])]
			.filter(Boolean)
			.join(" ")
			.trim();

	const title = pickString(lead, ["title", "jobTitle", "position"]);
	const companyName = pickString(lead, ["companyName", "company"]);
	const companyDomain = pickString(lead, ["companyDomain", "domain"]);
	const email = pickString(lead, ["email", "workEmail"]);
	const linkedin = pickString(lead, ["linkedinUrl", "linkedin"]);
	const location = pickString(lead, ["location", "city", "country"]);
	const tags = pickStringArray(lead, ["tags"]);
	const notes = pickString(lead, ["notes", "summary", "about"]);

	const lines: string[] = [];
	if (fullName) lines.push(`Name: ${fullName}`);
	if (title) lines.push(`Title: ${title}`);

	if (companyName || companyDomain) {
		lines.push(
			`Company: ${(companyName ?? "").trim()}${
				companyDomain ? ` (${companyDomain})` : ""
			}`.trim()
		);
	}

	if (location) lines.push(`Location: ${location}`);
	if (email) lines.push(`Email: ${email}`);
	if (linkedin) lines.push(`LinkedIn: ${linkedin}`);
	if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);
	if (notes) lines.push(`Notes: ${notes}`);

	// Keep doc compact and consistent.
	return clampText(lines.join("\n"), 4000);
}

@injectable()
export class LeadRagIndexProcessorService {
	private readonly prisma: PrismaClient = getPrisma();

	constructor(
		@inject(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
		private readonly ai: AiGrpcClient
	) {}

	private docId(leadId: string, directoryId: string): string {
		return `lead:${leadId}:${directoryId}`;
	}

	/**
	 * Fetch lead and its directoryIds at processing-time (idempotent, last-write-wins).
	 * If lead doesn't exist or is not verified -> delete from index (best effort).
	 */
	async upsertLeadNow(args: {
		ownerId: string;
		leadId: string;
		log?: LoggerLike;
	}): Promise<void> {
		const lg = ensureLogger(args.log);

		const lead = await this.prisma.lead.findFirst({
			where: {
				id: args.leadId,
				AND: [buildLeadVisibilityWhere(args.ownerId)],
			},
		});

		if (!lead) {
			lg.info(
				{ ownerId: args.ownerId, leadId: args.leadId },
				"RAG: lead not found or not visible -> delete doc"
			);
			await this.deleteLeadNow({
				ownerId: args.ownerId,
				leadId: args.leadId,
				log: lg,
			});
			return;
		}

		if (!lead.isVerified) {
			lg.info(
				{ ownerId: args.ownerId, leadId: args.leadId },
				"RAG: lead not verified -> delete doc"
			);
			await this.deleteLeadNow({
				ownerId: args.ownerId,
				leadId: args.leadId,
				log: lg,
			});
			return;
		}

		const directoryRows = await this.prisma.leadDirectoryLead.findMany({
			where: {
				leadId: args.leadId,
				directory: { ownerId: args.ownerId },
			},
			select: { directoryId: true },
		});

		const directoryIdsRaw: string[] = Array.isArray(directoryRows)
			? directoryRows
					.map((r) =>
						typeof r?.directoryId === "string" ? r.directoryId : null
					)
					.filter((x): x is string => typeof x === "string" && x.length > 0)
			: [];

		const uniqueDirectoryIds =
			directoryIdsRaw.length > 0
				? Array.from(new Set(directoryIdsRaw))
				: [UNASSIGNED_DIRECTORY_ID];

		const text = leadToRagText(lead);
		const updatedAtMs =
			lead.updatedAt instanceof Date
				? String(lead.updatedAt.getTime())
				: String(Date.now());

		const documents = uniqueDirectoryIds.map((dirId) => {
			const contentHash = createHash("sha256")
				.update(text)
				.update("\n")
				.update(dirId)
				.digest("hex");

			return {
				documentId: this.docId(args.leadId, dirId),
				leadId: args.leadId,
				directoryIds: [dirId],
				kind: LeadDocumentKind.LEAD_DOCUMENT_KIND_PROFILE,
				text,
				metadata: {
					ownerId: args.ownerId,
					leadId: args.leadId,
					directoryId: dirId,
				},
				updatedAtMs,
				contentHash,
			};
		});

		const req: UpsertLeadDocumentsRequest = {
			requestId: "", // AiGrpcClient will set UUID if empty
			workspaceId: args.ownerId,
			allowPartial: false,
			documents,
		};

		await this.ai.upsertLeadDocuments(req);

		lg.info(
			{
				ownerId: args.ownerId,
				leadId: args.leadId,
				directoryIdsCount: uniqueDirectoryIds.length,
			},
			"RAG: upserted lead doc"
		);
	}

	async deleteLeadNow(args: {
		ownerId: string;
		leadId: string;
		log?: LoggerLike;
	}): Promise<void> {
		const lg = ensureLogger(args.log);

		// Use leadIds selector to delete all documents for this lead, regardless of directory
		const req = {
			workspaceId: args.ownerId,
			leadIds: { values: [args.leadId] },
		} as unknown as DeleteLeadDocumentsRequest;

		await this.ai.deleteLeadDocuments(req);

		lg.info(
			{ ownerId: args.ownerId, leadId: args.leadId },
			"RAG: deleted lead doc"
		);
	}
}
