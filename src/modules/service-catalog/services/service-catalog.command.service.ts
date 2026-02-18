import { inject, injectable } from "inversify";

import { UserFacingError } from "@/infra/userFacingError";
import { SERVICE_CATALOG_TYPES } from "../service-catalog.types";
import type { ServiceCatalogRepository } from "../persistence/service-catalog.repository";

@injectable()
export class ServiceCatalogCommandService {
  constructor(
    @inject(SERVICE_CATALOG_TYPES.ServiceCatalogRepository)
    private readonly repo: ServiceCatalogRepository,
  ) {}

  // ── Services ──────────────────────────────────────────────────────

  async createService(companyId: string, name: string) {
    return this.repo.createService(companyId, name);
  }

  async updateService(
    companyId: string,
    serviceCatalogId: string,
    data: { name?: string },
  ) {
    await this.assertServiceOwnership(companyId, serviceCatalogId);
    return this.repo.updateService(serviceCatalogId, data);
  }

  async deleteService(companyId: string, serviceCatalogId: string) {
    await this.assertServiceOwnership(companyId, serviceCatalogId);
    await this.repo.deleteService(serviceCatalogId);
  }

  // ── Sub-services ──────────────────────────────────────────────────

  async createSubService(
    companyId: string,
    serviceCatalogId: string,
    data: {
      name: string;
      priority: number;
      budgetMin: number;
      budgetMax: number;
    },
  ) {
    await this.assertServiceOwnership(companyId, serviceCatalogId);
    return this.repo.createSubService(serviceCatalogId, data);
  }

  async updateSubService(
    companyId: string,
    subServiceId: string,
    data: {
      name?: string;
      priority?: number;
      budgetMin?: number;
      budgetMax?: number;
    },
  ) {
    const sub = await this.assertSubServiceOwnership(companyId, subServiceId);

    // Cross-validate budgetMin/budgetMax against existing values when only
    // one of them is provided in the partial update.
    const effectiveMin = data.budgetMin ?? sub.budgetMin;
    const effectiveMax = data.budgetMax ?? sub.budgetMax;

    if (effectiveMin > effectiveMax) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "budgetMin must be less than or equal to budgetMax",
      });
    }

    return this.repo.updateSubService(subServiceId, data);
  }

  async deleteSubService(companyId: string, subServiceId: string) {
    await this.assertSubServiceOwnership(companyId, subServiceId);
    await this.repo.deleteSubService(subServiceId);
  }

  // ── Ownership assertions ──────────────────────────────────────────

  private async assertServiceOwnership(
    companyId: string,
    serviceId: string,
  ): Promise<void> {
    const svc = await this.repo.findServiceById(serviceId);
    if (!svc || svc.companyId !== companyId) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Service not found",
      });
    }
  }

  private async assertSubServiceOwnership(
    companyId: string,
    subServiceId: string,
  ) {
    const sub = await this.repo.findSubServiceById(subServiceId);
    if (!sub || sub.companyServiceCatalog.companyId !== companyId) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Sub-service not found",
      });
    }
    return sub;
  }
}
