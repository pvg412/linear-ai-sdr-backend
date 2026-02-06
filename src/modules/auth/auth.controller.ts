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
} from "./schemas/auth.schemas";
import { UserRole } from "@prisma/client";

export function registerAuthRoutes(app: FastifyInstance, envArg?: Env) {
  const env = envArg ?? loadEnv();
  const service = new AuthService();

  app.post("/auth/login", async (request, reply) => {
    const body = loginBodySchema.parse(request.body);

    try {
      const result = await service.login(body.email, body.password, env);
      return reply.code(200).send(result);
    } catch {
      return reply.code(401).send({ message: "Invalid credentials" });
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
        const message = e instanceof Error ? e.message : String(e);
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
      const message = e instanceof Error ? e.message : String(e);
      if (
        /unique constraint/i.test(message) ||
        /unique.*failed/i.test(message)
      ) {
        return reply.code(409).send({ message: "Email already exists" });
      }
      return reply.code(400).send({ message });
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
        const message = e instanceof Error ? e.message : String(e);
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
      const result = await service.createCompany(body.email, body.password);
      return reply.code(201).send(result);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        /unique constraint/i.test(message) ||
        /unique.*failed/i.test(message)
      ) {
        return reply.code(409).send({ message: "Email already exists" });
      }
      return reply.code(400).send({ message });
    }
  });
}
