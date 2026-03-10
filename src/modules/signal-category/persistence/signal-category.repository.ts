import { injectable } from "inversify";
import type { PrismaClient, SignalCategory } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class SignalCategoryRepository {
  private readonly prisma: PrismaClient = getPrisma();

  /**
   * List all signal category configs for a specific service catalog.
   * Returns only the rows that exist — the controller fills in
   * defaults for categories not yet configured.
   */
  async listByServiceCatalog(serviceCatalogId: string) {
    return this.prisma.signalCategoryConfig.findMany({
      where: { serviceCatalogId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * List all signal category configs for ALL catalogs of a company.
   * Used by pipeline steps to determine which signal phases are enabled
   * across any catalog.
   */
  async listByCompany(companyId: string) {
    return this.prisma.signalCategoryConfig.findMany({
      where: { serviceCatalog: { companyId } },
      include: { serviceCatalog: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Upsert a single signal category config for a service catalog.
   * Uses the unique constraint on [serviceCatalogId, category].
   */
  async upsert(
    serviceCatalogId: string,
    category: SignalCategory,
    data: { description: string; enabled: boolean },
  ) {
    return this.prisma.signalCategoryConfig.upsert({
      where: {
        serviceCatalogId_category: { serviceCatalogId, category },
      },
      create: {
        serviceCatalogId,
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
   * Upsert multiple signal category configs for a service catalog
   * in a transaction.
   */
  async upsertMany(
    serviceCatalogId: string,
    items: { category: SignalCategory; description: string; enabled: boolean }[],
  ) {
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.signalCategoryConfig.upsert({
          where: {
            serviceCatalogId_category: { serviceCatalogId, category: item.category },
          },
          create: {
            serviceCatalogId,
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
