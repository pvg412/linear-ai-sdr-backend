import { injectable } from "inversify";
import { LeadStatus, Prisma } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class LeadRepository {
  async createMany(data: Prisma.LeadCreateManyInput[]) {
    const prisma = getPrisma();
    
    return prisma.lead.createMany({ data });
  }

  async updateStatus(id: string, status: LeadStatus) {
    const prisma = getPrisma();

    return prisma.lead.update({
      where: { id },
      data: { status },
    });
  }

  async findById(id: string) {
    const prisma = getPrisma();
    
    return prisma.lead.findUnique({ where: { id } });
  }

  async findBySearchTaskId(
    searchTaskId: string,
    params: { status?: LeadStatus; limit: number; offset: number }
  ) {
    const { status, limit, offset } = params;

    const prisma = getPrisma();

    return prisma.lead.findMany({
      where: {
        searchTaskId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: limit,
    });
  }
}
