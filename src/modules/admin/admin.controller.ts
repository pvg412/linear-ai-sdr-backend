import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";

import { container } from "@/container";
import { requireRequestUser } from "@/infra/auth/requestUser";
import { UserFacingError } from "@/infra/userFacingError";

import { ADMIN_TYPES } from "./admin.types";
import type { ServiceToggleService } from "./services/service-toggle.service";
import {
  UpdateServiceToggleBodySchema,
  ServiceToggleParamsSchema,
} from "./schemas/service-toggle.schemas";
import type { MonitoredSourceService } from "./services/monitored-source.service";
import {
  CreateMonitoredSourceBodySchema,
  UpdateMonitoredSourceBodySchema,
  MonitoredSourceParamsSchema,
  MonitoredSourceQuerySchema,
} from "./schemas/monitored-source.schemas";

function requireAdmin(role: string): void {
  if (role !== UserRole.ADMIN) {
    throw new UserFacingError({
      code: "FORBIDDEN",
      userMessage: "Admin access required.",
    });
  }
}

export function registerAdminRoutes(app: FastifyInstance): void {
  const toggleService = container.get<ServiceToggleService>(
    ADMIN_TYPES.ServiceToggleService,
  );
  const monitoredSourceService = container.get<MonitoredSourceService>(
    ADMIN_TYPES.MonitoredSourceService,
  );

  // ── GET /admin/service-toggles ──────────────────────────────────

  app.get("/admin/service-toggles", async (req) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    return toggleService.getAllToggles();
  });

  // ── PATCH /admin/service-toggles/:id ────────────────────────────

  app.patch("/admin/service-toggles/:id", async (req) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    const { id } = ServiceToggleParamsSchema.parse(req.params);
    const { enabled } = UpdateServiceToggleBodySchema.parse(req.body);

    return toggleService.setEnabled(id, enabled, user.id);
  });

  // ── GET /admin/monitored-sources ────────────────────────────────

  app.get("/admin/monitored-sources", async (req) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    const { channel } = MonitoredSourceQuerySchema.parse(req.query);

    return monitoredSourceService.list(channel);
  });

  // ── POST /admin/monitored-sources ───────────────────────────────

  app.post("/admin/monitored-sources", async (req) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    const body = CreateMonitoredSourceBodySchema.parse(req.body);

    return monitoredSourceService.create(body, user.id);
  });

  // ── PATCH /admin/monitored-sources/:id ──────────────────────────

  app.patch("/admin/monitored-sources/:id", async (req) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    const { id } = MonitoredSourceParamsSchema.parse(req.params);
    const { enabled } = UpdateMonitoredSourceBodySchema.parse(req.body);

    return monitoredSourceService.setEnabled(id, enabled, user.id);
  });
}
