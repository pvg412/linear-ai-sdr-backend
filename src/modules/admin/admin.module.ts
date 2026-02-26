import type { Container } from "inversify";

import { ADMIN_TYPES } from "./admin.types";
import { ServiceToggleRepository } from "./persistence/service-toggle.repository";
import { ServiceToggleService } from "./services/service-toggle.service";

export function registerAdminModule(container: Container): void {
  container
    .bind(ADMIN_TYPES.ServiceToggleRepository)
    .to(ServiceToggleRepository)
    .inSingletonScope();

  container
    .bind(ADMIN_TYPES.ServiceToggleService)
    .to(ServiceToggleService)
    .inSingletonScope();
}

/**
 * Initialise admin-module runtime state.
 * Must be called AFTER the DI container is built and the DB is reachable.
 *
 * 1. Seeds default service toggle rows (upsert — won't overwrite admin changes).
 * 2. Loads toggles into the in-memory cache for sync reads.
 */
export async function initAdminModule(container: Container): Promise<void> {
  const svc = container.get<ServiceToggleService>(ADMIN_TYPES.ServiceToggleService);
  await svc.seedDefaults();
  await svc.loadCache();
}
