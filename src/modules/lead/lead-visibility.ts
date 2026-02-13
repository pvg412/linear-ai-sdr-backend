import { Prisma, UserRole } from "@prisma/client";

export function buildLeadVisibilityWhere(opts: {
  ownerId: string;
  role?: string;
  companyId?: string | null;
}): Prisma.LeadWhereInput {
  // Admin sees everything.
  if (opts.role === UserRole.ADMIN) {
    return {};
  }

  // When the user belongs to a company, they can see leads created by:
  // - themselves
  // - any member of the same company (user.companyId matches)
  // - the company account itself (createdById === companyId)
  if (opts.companyId) {
    const result = {
      OR: [
        { createdById: opts.ownerId },
        { createdById: opts.companyId },
        { createdBy: { companyId: opts.companyId } },
      ],
    };
    return result;
  }

  return { createdById: opts.ownerId };
}
