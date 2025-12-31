import { inject, injectable } from "inversify";
import { ensureLogger, type LoggerLike } from "@/infra/observability";

import { LEAD_DIRECTORY_TYPES } from "../lead-directory.types";
import { LeadDirectoryNotFoundError } from "../lead-directory.errors";
import {
	isUnassignedDirectoryId,
	makeUnassignedDirectory,
	makeUnassignedTreeNode,
} from "../lead-directory.unassigned";
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

	async listAllFlat(
		ownerId: string,
		log?: LoggerLike
	): Promise<LeadDirectoryDto[]> {
		const lg = ensureLogger(log);
		const all = await this.repo.listAllForOwner(ownerId);
		const unassignedCount = await this.repo.countUnassignedLeads({ ownerId });

		// Useful for Multiselect dropdowns: stable, human-friendly ordering.
		const sorted = [...all].sort((a, b) => {
			const byName = a.name.localeCompare(b.name, undefined, {
				sensitivity: "base",
			});
			if (byName !== 0) return byName;
			if (a.position !== b.position) return a.position - b.position;
			return a.createdAt.getTime() - b.createdAt.getTime();
		});

		const items = [makeUnassignedDirectory(ownerId, unassignedCount), ...sorted];

		lg.debug({ ownerId, count: items.length }, "LeadDirectory listAllFlat");
		return items;
	}

	async getDirectory(
		ownerId: string,
		directoryId: string
	): Promise<LeadDirectoryDto> {
		if (isUnassignedDirectoryId(directoryId)) {
			const leadsCount = await this.repo.countUnassignedLeads({ ownerId });
			return makeUnassignedDirectory(ownerId, leadsCount);
		}

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

		// Inject synthetic root directory for unassigned leads.
		if (parentId === null) {
			const leadsCount = await this.repo.countUnassignedLeads({ ownerId });
			res.unshift(makeUnassignedDirectory(ownerId, leadsCount));
		}

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

		const unassignedCount = await this.repo.countUnassignedLeads({ ownerId });
		roots.unshift(makeUnassignedTreeNode(ownerId, unassignedCount));

		return roots;
	}

	async listLeads(
		ownerId: string,
		directoryId: string,
		input: { limit: number; offset: number }
	) {
		if (isUnassignedDirectoryId(directoryId)) {
			return this.repo.listUnassignedLeads({
				ownerId,
				limit: input.limit,
				offset: input.offset,
			});
		}

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
		const lead = await this.repo.getLeadStatus(leadId);
		// Unverified leads are system-internal and should not be exposed.
		if (!lead.exists || !lead.isVerified) return [];

		const items = await this.repo.listLeadDirectories({ ownerId, leadId });
		if (items.length > 0) return items;

		// Keep backward compatibility: only expose synthetic directory
		// if the lead actually exists.
		// (Lead existence already checked above.)

		const leadsCount = await this.repo.countUnassignedLeads({ ownerId });
		return [makeUnassignedDirectory(ownerId, leadsCount)];
	}
}
