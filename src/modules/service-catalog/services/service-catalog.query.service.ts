import { inject, injectable } from "inversify";

import { SERVICE_CATALOG_TYPES } from "../service-catalog.types";
import type { ServiceCatalogRepository } from "../persistence/service-catalog.repository";

export type ServiceCatalogWithAggregates = {
  id: string;
  companyId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  priorityAvg: number | null;
  budgetMinAvg: number | null;
  budgetMaxAvg: number | null;
  subServices: Array<{
    id: string;
    companyServiceCatalogId: string;
    name: string;
    priority: number;
    budgetMin: number;
    budgetMax: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

@injectable()
export class ServiceCatalogQueryService {
  constructor(
    @inject(SERVICE_CATALOG_TYPES.ServiceCatalogRepository)
    private readonly repo: ServiceCatalogRepository,
  ) {}

  async listServiceCatalog(
    companyId: string,
  ): Promise<ServiceCatalogWithAggregates[]> {
    const services = await this.repo.listByCompany(companyId);

    return services.map((svc) => {
      const subs = svc.subServices;
      const hasSubs = subs.length > 0;

      return {
        id: svc.id,
        companyId: svc.companyId,
        name: svc.name,
        createdAt: svc.createdAt,
        updatedAt: svc.updatedAt,
        priorityAvg: hasSubs ? avg(subs.map((s) => s.priority)) : null,
        budgetMinAvg: hasSubs ? avg(subs.map((s) => s.budgetMin)) : null,
        budgetMaxAvg: hasSubs ? avg(subs.map((s) => s.budgetMax)) : null,
        subServices: subs,
      };
    });
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}
