export const SERVICE_CATALOG_TYPES = {
  ServiceCatalogRepository: Symbol.for("ServiceCatalogRepository"),
  ServiceCatalogCommandService: Symbol.for("ServiceCatalogCommandService"),
  ServiceCatalogQueryService: Symbol.for("ServiceCatalogQueryService"),
} as const;
