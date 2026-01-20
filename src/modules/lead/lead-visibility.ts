import { Prisma } from "@prisma/client";

export function buildLeadVisibilityWhere(
  ownerId: string,
): Prisma.LeadWhereInput {
  return {
    OR: [
      { createdById: ownerId },
      { searches: { some: { leadSearch: { createdById: ownerId } } } },
      { leadDirectoryLeads: { some: { directory: { ownerId } } } },
    ],
  };
}
