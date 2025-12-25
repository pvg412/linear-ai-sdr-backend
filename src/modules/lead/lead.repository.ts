import { injectable } from "inversify";
import { Prisma, PrismaClient, UserRole } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";

function toIso(d: Date): string {
	return d.toISOString();
}

@injectable()
export class LeadRepository {
	private readonly prisma: PrismaClient = getPrisma();

	async listLeads(
		userId: string,
		role: UserRole,
		opts: {
			leadSearchId?: string;
			page?: number;
			perPage?: number;
		}
	) {
		const filters: Prisma.LeadWhereInput[] = [];

		if (!opts.page || !opts.perPage) {
			throw new UserFacingError({
				code: "BAD_REQUEST",
				userMessage: "Page and perPage are required",
			});
		}

		if (role !== UserRole.ADMIN) {
			filters.push({
				OR: [
					{ createdById: userId },
					{ searches: { some: { leadSearch: { createdById: userId } } } },
				],
			});
		}

		if (opts.leadSearchId) {
			filters.push({
				searches: { some: { leadSearchId: opts.leadSearchId } },
			});
		}

		const where: Prisma.LeadWhereInput =
			filters.length > 0 ? { AND: filters } : {};

		const [rows, total] = await this.prisma.$transaction([
			this.prisma.lead.findMany({
				where,
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: opts.perPage + 1,
				skip: (opts.page - 1) * opts.perPage,
				include: {
					searches: {
						select: {
							id: true,
							leadSearchId: true,
							status: true,
							assignedToId: true,
							notes: true,
							createdAt: true,
							updatedAt: true,
						},
					},
				},
			}),
			this.prisma.lead.count({ where }),
		]);

		const result = {
			items: rows.map((item) => ({
				id: item.id,
				createdById: item.createdById ?? null,
				fullName: item.fullName ?? null,
				firstName: item.firstName ?? null,
				lastName: item.lastName ?? null,
				title: item.title ?? null,
				company: item.company ?? null,
				companyDomain: item.companyDomain ?? null,
				companyUrl: item.companyUrl ?? null,
				linkedinUrl: item.linkedinUrl ?? null,
				location: item.location ?? null,
				email: item.email ?? null,
				createdAt: toIso(item.createdAt),
				updatedAt: toIso(item.updatedAt),
				leadSearches: item.searches.map((search) => ({
					id: search.id,
					leadSearchId: search.leadSearchId,
					status: search.status,
					assignedToId: search.assignedToId ?? null,
					notes: search.notes ?? null,
					createdAt: toIso(search.createdAt),
					updatedAt: toIso(search.updatedAt),
				})),
			})),
			total,
		};

		return result;
	}
}
