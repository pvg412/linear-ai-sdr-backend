import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { websocketPlugin } from "./plugins/websocket";
import { loadEnv } from "./config/env";
import { getPrisma } from "./infra/prisma";
import { container } from "./container";
import { QUEUE_TYPES } from "./infra/queue/queue.types";
import type { Redis } from "ioredis";
import { registerAuthRoutes } from "./modules/auth/auth.controller";
import { createAuthGuard } from "./modules/auth/auth.guard";
import { AuthService } from "./modules/auth/services/auth.service";
import { registerChatRoutes } from "./modules/chat/chat.controller";
import { registerLeadRoutes } from "./modules/lead/lead.controller";
import { registerLeadDirectoryRoutes } from "./modules/lead-directory/lead-directory.controller";
import { registerLeadSearchRoutes } from "./modules/lead-search/lead-search.controller";
import { registerCompanyResearchRoutes } from "./modules/company-research/company-research.controller";
import { registerProfileEnrichmentRoutes } from "./modules/profile-enrichment/profile-enrichment.controller";

export async function buildServer() {
  const env = loadEnv();

  const app = Fastify({
    logger: true,
  });

  await app.register(websocketPlugin);
  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? [env.FRONTEND_URL] : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    // credentials: true,
    maxAge: 86400,
  });

  // Swagger should not be exposed in production
  if (env.NODE_ENV !== "production") {
    await app.register(swagger, {
      openapi: {
        info: { title: "AI SDR API", version: "1.0.0" },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
            },
          },
        },
      },
    });
    await app.register(swaggerUi, {
      routePrefix: "/docs",
    });
  }

  // Health check endpoints (no auth required)
  app.get("/health", async () => {
    const checks: Record<string, boolean | string | number> = {
      status: "healthy",
      uptime: process.uptime(),
    };

    // Check database
    try {
      const prisma = getPrisma();
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
      checks.status = "unhealthy";
    }

    // Check Redis
    try {
      const redis = container.get<Redis>(QUEUE_TYPES.Redis);
      await redis.ping();
      checks.redis = true;
    } catch {
      checks.redis = false;
      // Redis is optional, don't mark as unhealthy
    }

    return checks;
  });

  app.get("/ready", async () => {
    // Check if the service is ready to accept traffic
    try {
      const prisma = getPrisma();
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready" };
    } catch {
      return { status: "not_ready" };
    }
  });

  // Auth routes first (login stays public)
  registerAuthRoutes(app, env);

  // Ensure at least one admin exists (via env in prod, optional in dev)
  const authService = new AuthService();
  await authService.ensureInitialAdmin(env, app.log);

  // Protect everything else
  app.addHook("onRequest", createAuthGuard(env));

  registerChatRoutes(app);
  registerLeadRoutes(app);
  registerLeadDirectoryRoutes(app);
  registerLeadSearchRoutes(app);
  registerCompanyResearchRoutes(app);
  registerProfileEnrichmentRoutes(app);

  return { app, env };
}
