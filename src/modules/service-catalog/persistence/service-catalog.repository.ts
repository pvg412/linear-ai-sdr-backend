import { injectable } from "inversify";
import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import { isP2002Unique } from "@/infra/observability";

@injectable()
export class ServiceCatalogRepository {
  private readonly prisma: PrismaClient = getPrisma();

  // ── Services ──────────────────────────────────────────────────────

  async listByCompany(companyId: string) {
    return this.prisma.companyServiceCatalog.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      include: {
        subServices: {
          orderBy: { createdAt: "asc" },
        },
        signalCategories: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  async findServiceById(id: string) {
    return this.prisma.companyServiceCatalog.findUnique({
      where: { id },
      select: { id: true, companyId: true, name: true },
    });
  }

  async createService(companyId: string, name: string) {
    try {
      return await this.prisma.companyServiceCatalog.create({
        data: { companyId, name },
      });
    } catch (e) {
      if (isP2002Unique(e)) {
        throw new UserFacingError({
          code: "CONFLICT",
          userMessage: "A service with this name already exists",
        });
      }
      throw e;
    }
  }

  async updateService(id: string, data: { name?: string }) {
    try {
      return await this.prisma.companyServiceCatalog.update({
        where: { id },
        data,
      });
    } catch (e) {
      if (isP2002Unique(e)) {
        throw new UserFacingError({
          code: "CONFLICT",
          userMessage: "A service with this name already exists",
        });
      }
      throw e;
    }
  }

  async deleteService(id: string) {
    await this.prisma.companyServiceCatalog.delete({
      where: { id },
    });
  }

  // ── Sub-services ──────────────────────────────────────────────────

  async findSubServiceById(id: string) {
    return this.prisma.companyServiceCatalogSubService.findUnique({
      where: { id },
      include: {
        companyServiceCatalog: {
          select: { companyId: true },
        },
      },
    });
  }

  async createSubService(
    companyServiceCatalogId: string,
    data: {
      name: string;
      priority: number;
      budgetMin: number;
      budgetMax: number;
    },
  ) {
    try {
      return await this.prisma.companyServiceCatalogSubService.create({
        data: {
          companyServiceCatalogId,
          ...data,
        },
      });
    } catch (e) {
      if (isP2002Unique(e)) {
        throw new UserFacingError({
          code: "CONFLICT",
          userMessage: "A sub-service with this name already exists in this service",
        });
      }
      throw e;
    }
  }

  async updateSubService(
    id: string,
    data: {
      name?: string;
      priority?: number;
      budgetMin?: number;
      budgetMax?: number;
    },
  ) {
    try {
      return await this.prisma.companyServiceCatalogSubService.update({
        where: { id },
        data,
      });
    } catch (e) {
      if (isP2002Unique(e)) {
        throw new UserFacingError({
          code: "CONFLICT",
          userMessage: "A sub-service with this name already exists in this service",
        });
      }
      throw e;
    }
  }

  async deleteSubService(id: string) {
    await this.prisma.companyServiceCatalogSubService.delete({
      where: { id },
    });
  }
}
