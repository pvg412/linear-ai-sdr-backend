import { Prisma } from "@prisma/client";

export function buildLeadVisibilityWhere(
  ownerId: string,
  companyId?: string | null,
): Prisma.LeadWhereInput {
  // When the user belongs to a company, they can see leads from all company members.
  if (companyId) {
    const companyMember = { companyId };
    return {
      OR: [
        { createdById: ownerId },
        { createdBy: companyMember },
        {
          searches: {
            some: {
              leadSearch: {
                OR: [
                  { createdById: ownerId },
                  { createdBy: companyMember },
                ],
              },
            },
          },
        },
        { leadDirectoryLeads: { some: { directory: { ownerId } } } },
        {
          leadDirectoryLeads: {
            some: { directory: { owner: companyMember } },
          },
        },
      ],
    };
  }

  return {
    OR: [
      { createdById: ownerId },
      { searches: { some: { leadSearch: { createdById: ownerId } } } },
      { leadDirectoryLeads: { some: { directory: { ownerId } } } },
    ],
  };
}
