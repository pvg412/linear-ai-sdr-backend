import type {
	LeadDirectoryDto,
	LeadDirectoryTreeNodeDto,
} from "./persistence/lead-directory.repository";

export const UNASSIGNED_DIRECTORY_ID = "__unassigned__";
export const UNASSIGNED_DIRECTORY_NAME = "Unassigned leads";

export function isUnassignedDirectoryId(directoryId: string): boolean {
	return directoryId === UNASSIGNED_DIRECTORY_ID;
}

export function makeUnassignedDirectory(
	ownerId: string,
	leadsCount: number
): LeadDirectoryDto {
	// Note: this directory is synthetic (not persisted in DB).
	const now = new Date();

	return {
		id: UNASSIGNED_DIRECTORY_ID,
		ownerId,
		parentId: null,
		name: UNASSIGNED_DIRECTORY_NAME,
		description: null,
		// Keep it first by default if client sorts by position.
		position: -1,
		createdAt: now,
		updatedAt: now,
		childrenCount: 0,
		leadsCount,
	};
}

export function makeUnassignedTreeNode(
	ownerId: string,
	leadsCount: number
): LeadDirectoryTreeNodeDto {
	return { ...makeUnassignedDirectory(ownerId, leadsCount), children: [] };
}


