import { inject, injectable } from "inversify";

import { LEAD_TYPES } from "../lead.types";
import { LeadRepository } from "../persistence/lead.repository";
import { LeadPaginationFilters } from "../schemas/lead.schemas";
import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";

@injectable()
export class LeadQueryService {
  constructor(
    @inject(LEAD_TYPES.LeadRepository)
    private readonly leadRepository: LeadRepository,
  ) { }

  private async assertUserExists(userId: string): Promise<void> {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }
  }

  private async assertLeadSearchAccessible(
    userId: string,
    leadSearchId: string,
    companyId?: string | null,
  ): Promise<void> {
    const prisma = getPrisma();
    const accessible = await prisma.leadSearch.findFirst({
      where: {
        id: leadSearchId,
        OR: companyId
          ? [{ createdById: userId }, { createdBy: { companyId } }]
          : [{ createdById: userId }],
      },
      select: { id: true },
    });
    if (!accessible) {
      throw new UserFacingError({
        code: "FORBIDDEN",
        userMessage: "LeadSearch not found or not accessible",
      });
    }
  }

  async listLeads(
    userId: string,
    opts: {
      role?: string;
      companyId?: string | null;
      page?: number;
      perPage?: number;
      filters?: LeadPaginationFilters;
    },
  ) {
    await this.assertUserExists(userId);

    return this.leadRepository.listLeads({
      ownerId: userId,
      role: opts.role,
      companyId: opts.companyId,
      page: opts.page,
      perPage: opts.perPage,
      filters: opts.filters,
    });
  }

  async listLeadsForLeadSearchIncludingUnverified(
    userId: string,
    input: {
      leadSearchId: string;
      role?: string;
      companyId?: string | null;
      page: number;
      perPage: number;
    },
  ) {
    await this.assertUserExists(userId);
    await this.assertLeadSearchAccessible(userId, input.leadSearchId, input.companyId);

    return this.leadRepository.listLeads({
      ownerId: userId,
      role: input.role,
      companyId: input.companyId,
      page: input.page,
      perPage: input.perPage,
      filters: { leadSearchId: input.leadSearchId },
      includeUnverified: true,
    });
  }

  async getLeadDetail(userId: string, leadId: string) {
    await this.assertUserExists(userId);

    const prisma = getPrisma();

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        emails: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        companyWebsites: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }

    return lead;
  }
}
