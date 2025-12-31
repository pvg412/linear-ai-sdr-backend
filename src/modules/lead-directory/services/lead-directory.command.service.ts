import { inject, injectable } from "inversify";
import { ensureLogger, type LoggerLike } from "@/infra/observability";

import { LEAD_DIRECTORY_TYPES } from "../lead-directory.types";
import {
	LeadDirectoryConflictError,
	LeadDirectoryNotFoundError,
	LeadDirectoryForbiddenError,
	LeadDirectoryValidationError,
} from "../lead-directory.errors";
import {
	LeadDirectoryRepository,
	type LeadDirectoryDto,
} from "../persistence/lead-directory.repository";

@injectable()
export class LeadDirectoryCommandService {
	constructor(
		@inject(LEAD_DIRECTORY_TYPES.LeadDirectoryRepository)
		private readonly repo: LeadDirectoryRepository
	) {}

	async createDirectory(
		ownerId: string,
		input: {
			name: string;
			parentId: string | null;
			description?: string | null;
			position?: number;
		},
		log?: LoggerLike
	): Promise<LeadDirectoryDto> {
		const lg = ensureLogger(log);

		if (input.parentId) {
			const parent = await this.repo.findOwnedById({
				ownerId,
				directoryId: input.parentId,
			});
			if (!parent)
				throw new LeadDirectoryNotFoundError("Parent directory not found");
		}

		const created = await this.repo.create({
			ownerId,
			name: input.name,
			parentId: input.parentId,
			description: input.description ?? null,
			position: input.position,
		});

		lg.info(
			{ ownerId, directoryId: created.id, parentId: created.parentId },
			"LeadDirectory created"
		);
		return created;
	}

	async updateDirectory(
		ownerId: string,
		directoryId: string,
		patch: { name?: string; description?: string | null; position?: number },
		log?: LoggerLike
	): Promise<LeadDirectoryDto> {
		const lg = ensureLogger(log);

		const updated = await this.repo.updateOwned({
			ownerId,
			directoryId,
			data: {
				...(patch.name !== undefined ? { name: patch.name } : {}),
				...(patch.description !== undefined
					? { description: patch.description }
					: {}),
				...(patch.position !== undefined ? { position: patch.position } : {}),
			},
		});

		if (!updated) throw new LeadDirectoryNotFoundError("Directory not found");

		lg.info({ ownerId, directoryId }, "LeadDirectory updated");
		return updated;
	}

	async moveDirectory(
		ownerId: string,
		directoryId: string,
		parentId: string | null,
		log?: LoggerLike
	): Promise<LeadDirectoryDto> {
		const lg = ensureLogger(log);

		const dir = await this.repo.findOwnedById({ ownerId, directoryId });
		if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");

		if (parentId === directoryId) {
			throw new LeadDirectoryValidationError(
				"Cannot set directory parent to itself"
			);
		}

		if (parentId) {
			const parent = await this.repo.findOwnedById({
				ownerId,
				directoryId: parentId,
			});
			if (!parent)
				throw new LeadDirectoryNotFoundError(
					"Target parent directory not found"
				);

			let cursor: string | null = parentId;
			while (cursor) {
				if (cursor === directoryId) {
					throw new LeadDirectoryConflictError(
						"Cannot move directory into its own subtree"
					);
				}
				cursor = await this.repo.findOwnedParentId({
					ownerId,
					directoryId: cursor,
				});
			}
		}

		const updated = await this.repo.updateOwned({
			ownerId,
			directoryId,
			data: { parentId },
		});

		if (!updated) throw new LeadDirectoryNotFoundError("Directory not found");

		lg.info({ ownerId, directoryId, parentId }, "LeadDirectory moved");
		return updated;
	}

	async deleteDirectory(
		ownerId: string,
		directoryId: string,
		log?: LoggerLike
	): Promise<void> {
		const lg = ensureLogger(log);

		const ok = await this.repo.deleteOwned({ ownerId, directoryId });
		if (!ok) throw new LeadDirectoryNotFoundError("Directory not found");

		lg.info({ ownerId, directoryId }, "LeadDirectory deleted");
	}

	async addLead(
		ownerId: string,
		directoryId: string,
		leadId: string,
		log?: LoggerLike
	): Promise<void> {
		const lg = ensureLogger(log);

		const dir = await this.repo.findOwnedById({ ownerId, directoryId });
		if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");

		const lead = await this.repo.getLeadStatus(leadId);
		if (!lead.exists) throw new LeadDirectoryNotFoundError("Lead not found");
		if (!lead.isVerified) {
			throw new LeadDirectoryForbiddenError("Lead is not verified");
		}

		await this.repo.addLeadToDirectory({ directoryId, leadId });

		lg.info({ ownerId, directoryId, leadId }, "Lead added to directory");
	}

	async removeLead(
		ownerId: string,
		directoryId: string,
		leadId: string,
		log?: LoggerLike
	): Promise<void> {
		const lg = ensureLogger(log);

		const dir = await this.repo.findOwnedById({ ownerId, directoryId });
		if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");

		await this.repo.removeLeadFromDirectory({ ownerId, directoryId, leadId });

		lg.info({ ownerId, directoryId, leadId }, "Lead removed from directory");
	}
}
