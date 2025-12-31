import { injectable } from "inversify";
import { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import { UNASSIGNED_DIRECTORY_ID } from "@/modules/lead-directory/lead-directory.unassigned";
import { LeadPaginationFilters } from "../schemas/lead.schemas";

function toIso(d: Date): string {
	return d.toISOString();
}

@injectable()
export class LeadRepository {
	private readonly prisma: PrismaClient = getPrisma();

	async listLeads(opts: {
		ownerId: string;
		filters?: LeadPaginationFilters;
		page?: number;
		perPage?: number;
		includeUnverified?: boolean;
	}) {
		const filters: Prisma.LeadWhereInput[] = [];

		// Unverified leads are system-internal and must not be displayed anywhere,
		// unless explicitly requested for leadSearch-scoped moderation flows.
		if (!opts.includeUnverified) {
			filters.push({ isVerified: true });
		}

		if (!opts.page || !opts.perPage) {
			throw new UserFacingError({
				code: "BAD_REQUEST",
				userMessage: "Page and perPage are required",
			});
		}

		if (opts.filters?.createdById) {
			filters.push({ createdById: opts.filters.createdById });
		}

		if (opts.filters?.email) {
			filters.push({
				email: { equals: opts.filters.email, mode: "insensitive" },
			});
		}

		if (opts.filters?.leadSearchId) {
			filters.push({
				searches: { some: { leadSearchId: opts.filters.leadSearchId } },
			});
		}

		if (opts.filters?.directoryId) {
			if (opts.filters.directoryId === UNASSIGNED_DIRECTORY_ID) {
				// Unassigned = lead is not linked to any directory.
				filters.push({
					leadDirectoryLeads: {
						none: { directory: { ownerId: opts.ownerId } },
					},
				});
			} else {
				filters.push({
					leadDirectoryLeads: {
						some: {
							directoryId: opts.filters.directoryId,
							directory: { ownerId: opts.ownerId },
						},
					},
				});
			}
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
					leadDirectoryLeads: {
						where: { directory: { ownerId: opts.ownerId } },
						select: {
							directory: { select: { id: true, name: true, parentId: true } },
						},
					},
				},
			}),
			this.prisma.lead.count({ where }),
		]);

		const result = {
			items: rows.map((item) => ({
				id: item.id,
				isVerified: item.isVerified,
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
				directories: item.leadDirectoryLeads.map((rel) => ({
					id: rel.directory.id,
					name: rel.directory.name,
					parentId: rel.directory.parentId ?? null,
				})),
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
