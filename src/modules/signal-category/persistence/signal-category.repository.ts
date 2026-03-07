import { injectable } from "inversify";
import type { PrismaClient, SignalCategory } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class SignalCategoryRepository {
  private readonly prisma: PrismaClient = getPrisma();

  /**
   * List all signal category configs for a company.
   * Returns only the rows that exist — the controller fills in
   * defaults for categories not yet configured.
   */
  async listByCompany(companyId: string) {
    return this.prisma.signalCategoryConfig.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Upsert a single signal category config.
   * Uses the unique constraint on [companyId, category].
   */
  async upsert(
    companyId: string,
    category: SignalCategory,
    data: { description: string; enabled: boolean },
  ) {
    return this.prisma.signalCategoryConfig.upsert({
      where: {
        companyId_category: { companyId, category },
      },
      create: {
        companyId,
        category,
        description: data.description,
        enabled: data.enabled,
      },
      update: {
        description: data.description,
        enabled: data.enabled,
      },
    });
  }

  /**
   * Upsert multiple signal category configs in a transaction.
   */
  async upsertMany(
    companyId: string,
    items: { category: SignalCategory; description: string; enabled: boolean }[],
  ) {
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.signalCategoryConfig.upsert({
          where: {
            companyId_category: { companyId, category: item.category },
          },
          create: {
            companyId,
            category: item.category,
            description: item.description,
            enabled: item.enabled,
          },
          update: {
            description: item.description,
            enabled: item.enabled,
          },
        }),
      ),
    );
  }
}
