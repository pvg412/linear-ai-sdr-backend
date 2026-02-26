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
}
