import { inject, injectable } from "inversify";
import { ensureLogger, type LoggerLike } from "@/infra/observability";

import { LEAD_DIRECTORY_TYPES } from "../lead-directory.types";
import { LeadDirectoryNotFoundError } from "../lead-directory.errors";
import {
	LeadDirectoryRepository,
	type LeadDirectoryDto,
	type LeadDirectoryTreeNodeDto,
} from "../persistence/lead-directory.repository";

@injectable()
export class LeadDirectoryQueryService {
	constructor(
		@inject(LEAD_DIRECTORY_TYPES.LeadDirectoryRepository)
		private readonly repo: LeadDirectoryRepository
	) {}

	async getDirectory(
		ownerId: string,
		directoryId: string
	): Promise<LeadDirectoryDto> {
		const dir = await this.repo.findOwnedById({ ownerId, directoryId });
		if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");
		return dir;
	}

	async listChildren(
		ownerId: string,
		parentId: string | null,
		log?: LoggerLike
	): Promise<LeadDirectoryDto[]> {
		const lg = ensureLogger(log);
		const res = await this.repo.listByParent({ ownerId, parentId });
		lg.debug(
			{ ownerId, parentId, count: res.length },
			"LeadDirectory listChildren"
		);
		return res;
	}

	async getTree(ownerId: string): Promise<LeadDirectoryTreeNodeDto[]> {
		const all = await this.repo.listAllForOwner(ownerId);

		const byId = new Map<string, LeadDirectoryTreeNodeDto>();
		for (const d of all) {
			byId.set(d.id, { ...d, children: [] });
		}

		const roots: LeadDirectoryTreeNodeDto[] = [];

		for (const d of all) {
			const node = byId.get(d.id)!;
			if (d.parentId) {
				const parent = byId.get(d.parentId);
				if (parent) parent.children.push(node);
				else roots.push(node);
			} else {
				roots.push(node);
			}
		}

		return roots;
	}

	async listLeads(
		ownerId: string,
		directoryId: string,
		input: { limit: number; offset: number }
	) {
		const dir = await this.repo.findOwnedById({ ownerId, directoryId });
		if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");

		return this.repo.listDirectoryLeads({
			ownerId,
			directoryId,
			limit: input.limit,
			offset: input.offset,
		});
	}

	async listDirectoriesForLead(
		ownerId: string,
		leadId: string
	): Promise<LeadDirectoryDto[]> {
		return this.repo.listLeadDirectories({ ownerId, leadId });
	}
}
