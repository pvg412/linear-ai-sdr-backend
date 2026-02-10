import { injectable } from "inversify";
import { type PrismaClient, UserRole } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

export type CompanyOption = {
  id: string;
  name: string;
};

@injectable()
export class DatasetImportQueryService {
  private readonly prisma: PrismaClient = getPrisma();

  async getCompanyList(): Promise<CompanyOption[]> {
    const companies = await this.prisma.user.findMany({
      where: { role: UserRole.COMPANY },
      select: {
        id: true,
        email: true,
      },
      orderBy: { email: "asc" },
    });

    return companies.map((c) => ({
      id: c.id,
      name: c.email, // Use email as company name
    }));
  }
}
