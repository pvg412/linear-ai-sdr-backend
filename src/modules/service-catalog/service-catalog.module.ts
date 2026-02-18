import type { Container } from "inversify";

import { SERVICE_CATALOG_TYPES } from "./service-catalog.types";
import { ServiceCatalogRepository } from "./persistence/service-catalog.repository";
import { ServiceCatalogCommandService } from "./services/service-catalog.command.service";
import { ServiceCatalogQueryService } from "./services/service-catalog.query.service";

export function registerServiceCatalogModule(container: Container): void {
  container
    .bind<ServiceCatalogRepository>(SERVICE_CATALOG_TYPES.ServiceCatalogRepository)
    .to(ServiceCatalogRepository)
    .inSingletonScope();

  container
    .bind<ServiceCatalogCommandService>(SERVICE_CATALOG_TYPES.ServiceCatalogCommandService)
    .to(ServiceCatalogCommandService)
    .inSingletonScope();

  container
    .bind<ServiceCatalogQueryService>(SERVICE_CATALOG_TYPES.ServiceCatalogQueryService)
    .to(ServiceCatalogQueryService)
    .inSingletonScope();
}
