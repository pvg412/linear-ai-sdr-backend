import type { FastifyInstance } from "fastify";

import type { Env } from "@/config/env";
import { loadEnv } from "@/config/env";
import { AuthService } from "./auth.service";
import {
  createSaleManagerBodySchema,
  devRegisterBodySchema,
  loginBodySchema,
} from "./auth.schemas";
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
        const result = await service.devRegisterAdmin(body.email, body.password);
        return reply.code(201).send(result);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return reply.code(400).send({ message });
      }
    });
  }

  app.post("/auth/users/sale-managers", async (request, reply) => {
    if (request.user?.role !== UserRole.ADMIN) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const body = createSaleManagerBodySchema.parse(request.body);

    try {
      const result = await service.createSaleManager(body.email, body.password);
      return reply.code(201).send(result);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      // Best-effort Prisma unique constraint mapping without relying on Prisma error types here.
      if (/unique constraint/i.test(message) || /unique.*failed/i.test(message)) {
        return reply.code(409).send({ message: "Email already exists" });
      }
      return reply.code(400).send({ message });
    }
  });
}

