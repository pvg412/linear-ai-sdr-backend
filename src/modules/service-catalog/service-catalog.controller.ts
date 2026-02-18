import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";

import { requireRequestUser } from "@/infra/auth/requestUser";
import { UserFacingError } from "@/infra/userFacingError";
import { container } from "@/container";
import { SERVICE_CATALOG_TYPES } from "./service-catalog.types";
import type { ServiceCatalogCommandService } from "./services/service-catalog.command.service";
import type { ServiceCatalogQueryService } from "./services/service-catalog.query.service";
import {
  createServiceBodySchema,
  updateServiceBodySchema,
  serviceCatalogIdParamsSchema,
  createSubServiceBodySchema,
  updateSubServiceBodySchema,
  subServiceIdParamsSchema,
} from "./schemas/service-catalog.schemas";

function requireCompanyUser(req: { user?: { id: string; role: string } }) {
  const user = requireRequestUser(req as Parameters<typeof requireRequestUser>[0]);
  if (user.role !== UserRole.COMPANY) {
    throw new UserFacingError({
      code: "FORBIDDEN",
      userMessage: "Only company accounts can manage the service catalog",
    });
  }
  return { companyId: user.id };
}

export function registerServiceCatalogRoutes(app: FastifyInstance): void {
  const commandService = container.get<ServiceCatalogCommandService>(
    SERVICE_CATALOG_TYPES.ServiceCatalogCommandService,
  );
  const queryService = container.get<ServiceCatalogQueryService>(
    SERVICE_CATALOG_TYPES.ServiceCatalogQueryService,
  );

  // ── Services ──────────────────────────────────────────────────────

  app.get("/company/service-catalog", async (req) => {
    const { companyId } = requireCompanyUser(req);
    return queryService.listServiceCatalog(companyId);
  });

  app.post("/company/service-catalog", async (req, reply) => {
    const { companyId } = requireCompanyUser(req);
    const body = createServiceBodySchema.parse(req.body);
    const service = await commandService.createService(companyId, body.name);
    return reply.code(201).send(service);
  });

  app.patch("/company/service-catalog/:serviceCatalogId", async (req) => {
    const { companyId } = requireCompanyUser(req);
    const { serviceCatalogId } = serviceCatalogIdParamsSchema.parse(req.params);
    const body = updateServiceBodySchema.parse(req.body);
    return commandService.updateService(companyId, serviceCatalogId, body);
  });

  app.delete("/company/service-catalog/:serviceCatalogId", async (req, reply) => {
    const { companyId } = requireCompanyUser(req);
    const { serviceCatalogId } = serviceCatalogIdParamsSchema.parse(req.params);
    await commandService.deleteService(companyId, serviceCatalogId);
    return reply.code(200).send({ success: true });
  });

  // ── Sub-services ──────────────────────────────────────────────────

  app.post(
    "/company/service-catalog/:serviceCatalogId/sub-services",
    async (req, reply) => {
      const { companyId } = requireCompanyUser(req);
      const { serviceCatalogId } = serviceCatalogIdParamsSchema.parse(req.params);
      const body = createSubServiceBodySchema.parse(req.body);
      const subService = await commandService.createSubService(
        companyId,
        serviceCatalogId,
        body,
      );
      return reply.code(201).send(subService);
    },
  );

  app.patch(
    "/company/service-catalog/sub-services/:subServiceId",
    async (req) => {
      const { companyId } = requireCompanyUser(req);
      const { subServiceId } = subServiceIdParamsSchema.parse(req.params);
      const body = updateSubServiceBodySchema.parse(req.body);
      return commandService.updateSubService(companyId, subServiceId, body);
    },
  );

  app.delete(
    "/company/service-catalog/sub-services/:subServiceId",
    async (req, reply) => {
      const { companyId } = requireCompanyUser(req);
      const { subServiceId } = subServiceIdParamsSchema.parse(req.params);
      await commandService.deleteSubService(companyId, subServiceId);
      return reply.code(200).send({ success: true });
    },
  );
}
