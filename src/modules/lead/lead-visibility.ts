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

  // For COMPANY role, the user *is* the company — their members reference
  // them via companyId === ownerId. For SALE_MANAGER, companyId points to
  // the parent company. In both cases resolve to a single effective ID.
  const effectiveCompanyId =
    opts.role === UserRole.COMPANY ? opts.ownerId : opts.companyId;

  if (effectiveCompanyId) {
    return {
      OR: [
        // Leads created by members whose companyId points to the company.
        { createdBy: { companyId: effectiveCompanyId } },
        // Leads created by the company account itself (its own companyId is null).
        { createdById: effectiveCompanyId },
      ],
    };
  }

  return { createdById: opts.ownerId };
}
