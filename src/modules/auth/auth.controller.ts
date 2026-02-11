import type { FastifyInstance } from "fastify";

import type { Env } from "@/config/env";
import { loadEnv } from "@/config/env";
import { AuthService } from "./services/auth.service";
import {
  createSaleManagerBodySchema,
  createCompanyBodySchema,
  listSaleManagersQuerySchema,
  saleManagerIdParamsSchema,
  devRegisterBodySchema,
  loginBodySchema,
  updateCompanyNameBodySchema,
  updateCustomInstructionsBodySchema,
} from "./schemas/auth.schemas";
import { UserRole } from "@prisma/client";
import { getUserFacingMessage } from "@/infra/userFacingError";

export function registerAuthRoutes(app: FastifyInstance, envArg?: Env) {
  const env = envArg ?? loadEnv();
  const service = new AuthService();

  app.post("/auth/login", async (request, reply) => {
    const body = loginBodySchema.parse(request.body);

    try {
      const result = await service.login(body.email, body.password, env);
      return reply.code(200).send(result);
    } catch (e: unknown) {
      const message = getUserFacingMessage(e) ?? "Invalid credentials";
      return reply.code(401).send({ message });
    }
  });

  // Dev-only helper to create the first admin user.
  if (env.NODE_ENV !== "production" && env.AUTH_ALLOW_DEV_REGISTER) {
    app.post("/auth/dev-register", async (request, reply) => {
      const body = devRegisterBodySchema.parse(request.body);

      try {
        const result = await service.devRegisterAdmin(
          body.email,
          body.password,
        );
        return reply.code(201).send(result);
      } catch (e: unknown) {
        const message = getUserFacingMessage(e) ?? "Registration failed";
        return reply.code(400).send({ message });
      }
    });
  }

  // Create a sale manager (ADMIN or COMPANY)
  app.post("/auth/users/sale-managers", async (request, reply) => {
    const role = request.user?.role;

    if (role !== UserRole.ADMIN && role !== UserRole.COMPANY) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const body = createSaleManagerBodySchema.parse(request.body);

    // When a COMPANY creates a sale manager, auto-set companyId
    const companyId =
      role === UserRole.COMPANY ? request.user!.id : undefined;

    try {
      const result = await service.createSaleManager(
        body.email,
        body.password,
        companyId,
      );
      return reply.code(201).send(result);
    } catch (e: unknown) {
      const message = getUserFacingMessage(e);
      if (message) {
        return reply.code(400).send({ message });
      }
      const raw = e instanceof Error ? e.message : String(e);
      if (
        /unique constraint/i.test(raw) ||
        /unique.*failed/i.test(raw)
      ) {
        return reply.code(409).send({ message: "Email already exists" });
      }
      return reply.code(400).send({ message: "Failed to create sale manager" });
    }
  });

  // List sale managers belonging to this company (COMPANY only)
  app.get("/auth/users/sale-managers", async (request, reply) => {
    if (request.user?.role !== UserRole.COMPANY) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const query = listSaleManagersQuerySchema.parse(request.query);
    const result = await service.listCompanySaleManagers(
      request.user.id,
      query.page,
      query.perPage,
    );

    return reply.code(200).send(result);
  });

  // Deactivate a sale manager (COMPANY only)
  app.delete(
    "/auth/users/sale-managers/:saleManagerId",
    async (request, reply) => {
      if (request.user?.role !== UserRole.COMPANY) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const params = saleManagerIdParamsSchema.parse(request.params);

      try {
        await service.removeCompanySaleManager(
          request.user.id,
          params.saleManagerId,
        );
        return reply
          .code(200)
          .send({ success: true, message: "Sale manager deactivated" });
      } catch (e: unknown) {
        const message = getUserFacingMessage(e) ?? "Sale manager not found";
        return reply.code(404).send({ message });
      }
    },
  );

  // Create a company user (ADMIN only)
  app.post("/auth/users/companies", async (request, reply) => {
    if (request.user?.role !== UserRole.ADMIN) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const body = createCompanyBodySchema.parse(request.body);

    try {
      const result = await service.createCompany(body.email, body.password, body.companyName);
      return reply.code(201).send(result);
    } catch (e: unknown) {
      const message = getUserFacingMessage(e);
      if (message) {
        return reply.code(400).send({ message });
      }
      const raw = e instanceof Error ? e.message : String(e);
      if (
        /unique constraint/i.test(raw) ||
        /unique.*failed/i.test(raw)
      ) {
        if (/email/i.test(raw)) {
          return reply.code(409).send({ message: "Email already exists" });
        }
        if (/companyName/i.test(raw)) {
          return reply.code(409).send({ message: "Company name already exists" });
        }
        return reply.code(409).send({ message: "Duplicate value detected" });
      }
      return reply.code(400).send({ message: "Failed to create company" });
    }
  });

  // Get user info (authenticated users)
  app.get("/auth/me", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    try {
      const userInfo = await service.getUserInfo(request.user.id);
      return reply.code(200).send({ user: userInfo });
    } catch (e: unknown) {
      const message = getUserFacingMessage(e) ?? "User not found";
      return reply.code(404).send({ message });
    }
  });

  // Update company name (COMPANY only)
  app.patch("/auth/me/company-name", async (request, reply) => {
    if (request.user?.role !== UserRole.COMPANY) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const body = updateCompanyNameBodySchema.parse(request.body);

    try {
      const updatedUser = await service.updateCompanyName(
        request.user.id,
        body.companyName,
      );
      return reply.code(200).send({ user: updatedUser });
    } catch (e: unknown) {
      const message = getUserFacingMessage(e);
      if (message) {
        return reply.code(400).send({ message });
      }
      const raw = e instanceof Error ? e.message : String(e);
      if (
        /unique constraint/i.test(raw) ||
        /unique.*failed/i.test(raw)
      ) {
        return reply.code(409).send({ message: "Company name already exists" });
      }
      return reply.code(400).send({ message: "Failed to update company name" });
    }
  });

  // Update custom instructions
  app.put("/auth/me/custom-instructions", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    const body = updateCustomInstructionsBodySchema.parse(request.body);

    try {
      const updatedUser = await service.updateCustomInstructions(
        request.user.id,
        body.customInstructions,
      );
      return reply.code(200).send({ user: updatedUser });
    } catch (e: unknown) {
      const message = getUserFacingMessage(e) ?? "Failed to update custom instructions";
      return reply.code(400).send({ message });
    }
  });
}
