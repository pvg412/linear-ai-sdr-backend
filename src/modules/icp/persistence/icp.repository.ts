import { injectable } from "inversify";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

interface UpsertIcpData {
  locations: string[];
  companySizes: string[];
  industries: { industryId: string; label: string }[];
}

@injectable()
export class IcpRepository {
  private readonly prisma: PrismaClient = getPrisma();

  /**
   * Get the ICP config for a company, including industries.
   * Returns null if no config exists yet.
   */
  async getByCompanyId(companyId: string) {
    return this.prisma.companyIcpConfig.findUnique({
      where: { companyId },
      include: {
        industries: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  /**
   * Upsert the ICP config for a company.
   * Uses a transaction to:
   * 1. Upsert the config (locations + companySizes)
   * 2. Delete all existing industries for this config
   * 3. Create new industries from the provided list
   */
  async upsert(companyId: string, data: UpsertIcpData) {
    return this.prisma.$transaction(async (tx) => {
      const config = await tx.companyIcpConfig.upsert({
        where: { companyId },
        create: {
          companyId,
          locations: data.locations,
          companySizes: data.companySizes,
        },
        update: {
          locations: data.locations,
          companySizes: data.companySizes,
        },
      });

      // Replace all industries: delete then create
      await tx.companyIcpIndustry.deleteMany({
        where: { configId: config.id },
      });

      if (data.industries.length > 0) {
        await tx.companyIcpIndustry.createMany({
          data: data.industries.map((ind) => ({
            configId: config.id,
            industryId: ind.industryId,
            label: ind.label,
          })),
        });
      }

      // Return the full config with industries
      return tx.companyIcpConfig.findUniqueOrThrow({
        where: { id: config.id },
        include: {
          industries: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });
  }
}
