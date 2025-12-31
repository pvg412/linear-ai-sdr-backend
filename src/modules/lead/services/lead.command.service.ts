import { injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";

export type LeadVerificationPatch = {
	id: string;
	isVerified: boolean;
};

@injectable()
export class LeadCommandService {
	async setLeadsVerificationForLeadSearch(
		userId: string,
		input: { leadSearchId: string; items: LeadVerificationPatch[] }
	): Promise<{ updated: number }> {
		const prisma = getPrisma();

		await this.assertLeadSearchOwned(userId, input.leadSearchId);

		const unique = new Map<string, boolean>();
		for (const item of input.items) unique.set(item.id, item.isVerified);
		const leadIds = [...unique.keys()];

		if (leadIds.length === 0) {
			throw new UserFacingError({
				code: "BAD_REQUEST",
				userMessage: "items must contain at least one lead",
			});
		}

		const rels = await prisma.leadSearchLead.findMany({
			where: {
				leadSearchId: input.leadSearchId,
				leadId: { in: leadIds },
			},
			select: { leadId: true },
		});

		const existing = new Set(rels.map((r) => r.leadId));
		const missing = leadIds.filter((id) => !existing.has(id));
		if (missing.length > 0) {
			throw new UserFacingError({
				code: "BAD_REQUEST",
				userMessage: "Some leads do not belong to the provided leadSearchId",
				details: { missingLeadIds: missing },
			});
		}

		const toTrue: string[] = [];
		const toFalse: string[] = [];
		for (const [id, isVerified] of unique.entries()) {
			(isVerified ? toTrue : toFalse).push(id);
		}

		const res = await prisma.$transaction(async (tx) => {
			const [a, b] = await Promise.all([
				toTrue.length > 0
					? tx.lead.updateMany({
							where: { id: { in: toTrue } },
							data: { isVerified: true },
						})
					: Promise.resolve({ count: 0 }),
				toFalse.length > 0
					? tx.lead.updateMany({
							where: { id: { in: toFalse } },
							data: { isVerified: false },
						})
					: Promise.resolve({ count: 0 }),
			]);

			return { updated: a.count + b.count };
		});

		return res;
	}

	// Keep this logic colocated for reuse across lead-search scoped endpoints.
	private async assertLeadSearchOwned(
		userId: string,
		leadSearchId: string
	): Promise<void> {
		const prisma = getPrisma();

		const owned = await prisma.leadSearch.findFirst({
			where: { id: leadSearchId, createdById: userId },
			select: { id: true },
		});

		if (!owned) {
			throw new UserFacingError({
				code: "FORBIDDEN",
				userMessage: "LeadSearch not found or not owned by user",
			});
		}
	}
}


