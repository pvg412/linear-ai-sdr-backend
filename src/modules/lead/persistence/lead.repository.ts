import { injectable } from "inversify";
import { Prisma, PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import { UNASSIGNED_DIRECTORY_ID } from "@/modules/lead-directory/lead-directory.unassigned";
import { buildLeadVisibilityWhere } from "@/modules/lead/lead-visibility";
import { LeadPaginationFilters } from "../schemas/lead.schemas";

function toIso(d: Date): string {
  return d.toISOString();
}

export function buildLeadWhere(opts: {
  ownerId: string;
  role?: string;
  companyId?: string | null;
  filters?: LeadPaginationFilters;
  includeUnverified?: boolean;
}): Prisma.LeadWhereInput {
  const andFilters: Prisma.LeadWhereInput[] = [];

  andFilters.push(buildLeadVisibilityWhere({ ownerId: opts.ownerId, role: opts.role, companyId: opts.companyId }));

  // Unverified leads are system-internal and must not be displayed anywhere,
  // unless explicitly requested for leadSearch-scoped moderation flows.
  if (!opts.includeUnverified) {
    andFilters.push({ isVerified: true });
  }

  if (opts.filters?.createdById) {
    andFilters.push({ createdById: opts.filters.createdById });
  }

  if (opts.filters?.origin) {
    andFilters.push({ origin: opts.filters.origin });
  }

  if (opts.filters?.email) {
    andFilters.push({
      email: { equals: opts.filters.email, mode: "insensitive" },
    });
  }

  if (opts.filters?.leadSearchId) {
    andFilters.push({
      searches: { some: { leadSearchId: opts.filters.leadSearchId } },
    });
  }

  const rawDirectoryIds =
    opts.filters?.directoryIds ??
    (opts.filters?.directoryId ? [opts.filters.directoryId] : [UNASSIGNED_DIRECTORY_ID]);

  if (rawDirectoryIds.length) {
    const uniqueDirectoryIds = Array.from(new Set(rawDirectoryIds));
    const includeUnassigned = uniqueDirectoryIds.includes(
      UNASSIGNED_DIRECTORY_ID,
    );
    const directoryIds = uniqueDirectoryIds.filter(
      (id) => id !== UNASSIGNED_DIRECTORY_ID,
    );

    const orFilters: Prisma.LeadWhereInput[] = [];

    if (directoryIds.length > 0) {
      orFilters.push({
        leadDirectoryLeads: {
          some: {
            directoryId: { in: directoryIds },
            directory: { ownerId: opts.ownerId },
          },
        },
      });
    }

    if (includeUnassigned) {
      // Unassigned = lead is not linked to any of the current user's own directories.
      // We intentionally use ownerId-only here (not company-wide) so that a lead
      // placed in a colleague's directory still shows as "unassigned" for this user.
      orFilters.push({
        leadDirectoryLeads: {
          none: { directory: { ownerId: opts.ownerId } },
        },
      });
    }

    if (orFilters.length === 1) {
      andFilters.push(orFilters[0]);
    } else if (orFilters.length > 1) {
      andFilters.push({ OR: orFilters });
    }
  }

  const search = opts.filters?.search?.trim();
  if (search) {
    andFilters.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
        { companyDomain: { contains: search, mode: "insensitive" } },
        { companyUrl: { contains: search, mode: "insensitive" } },
        { linkedinUrl: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  return andFilters.length > 0 ? { AND: andFilters } : {};
}

@injectable()
export class LeadRepository {
  private readonly prisma: PrismaClient = getPrisma();

  async listLeads(opts: {
    ownerId: string;
    role?: string;
    companyId?: string | null;
    filters?: LeadPaginationFilters;
    page?: number;
    perPage?: number;
    includeUnverified?: boolean;
  }) {
    if (!opts.page || !opts.perPage) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "Page and perPage are required",
      });
    }

    const where = buildLeadWhere({
      ownerId: opts.ownerId,
      role: opts.role,
      companyId: opts.companyId,
      filters: opts.filters,
      includeUnverified: opts.includeUnverified,
    });

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: [
          { hasPendingEnrichment: "desc" }, // Pending enrichment first
          { createdAt: "desc" },
          { id: "desc" },
        ],
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
            where: {
              directory: { ownerId: opts.ownerId }
            },
            select: {
              directory: {
                select: {
                  id: true,
                  name: true,
                  parentId: true,
                  parent: { select: { name: true } },
                },
              },
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
        hasPendingEnrichment: item.hasPendingEnrichment,
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
        emailStatus: item.emailStatus ?? null,
        createdAt: toIso(item.createdAt),
        updatedAt: toIso(item.updatedAt),
        directories: item.leadDirectoryLeads.map((rel) => ({
          id: rel.directory.id,
          name: rel.directory.name,
          parentName: rel.directory.parent?.name ?? null,
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
