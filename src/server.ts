import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
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
import { registerLeadConversationsRoutes } from "./modules/lead-conversations/controller/lead-conversations.controller";
import { registerDatasetImportRoutes } from "./modules/dataset-import/dataset-import.controller";
import { registerServiceCatalogRoutes } from "./modules/service-catalog/service-catalog.controller";
import { registerSignalCategoryRoutes } from "./modules/signal-category/signal-category.controller";
import { registerIcpRoutes } from "./modules/icp/icp.controller";
import { registerPipelineRoutes } from "./modules/pipeline/pipeline.controller";
import { registerAdminRoutes } from "./modules/admin/admin.controller";
import { initAdminModule } from "./modules/admin/admin.module";
import { registerBalanceRoutes } from "./modules/balance/balance.controller";
import { UserFacingError } from "./infra/userFacingError";

function getStatusCodeFromErrorCode(code: string): number {
  const codeMap: Record<string, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
  };

  return codeMap[code] ?? 500;
}

export async function buildServer() {
  const env = loadEnv();

  const app = Fastify({
    logger: true,
  });

  // Global error handler for UserFacingError
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof UserFacingError) {
      const statusCode = getStatusCodeFromErrorCode(error.code);
      return reply.status(statusCode).send({
        error: error.code,
        message: error.userMessage,
        ...(error.details && { details: error.details }),
      });
    }

    // Default error handling
    request.log.error(error);
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    });
  });

  await app.register(websocketPlugin);
  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? [env.FRONTEND_URL] : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    // credentials: true,
    maxAge: 86400,
  });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
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

  // Seed service toggles and load cache before any adapter resolves
  await initAdminModule(container);

  // Protect everything else
  app.addHook("onRequest", createAuthGuard(env));

  registerChatRoutes(app);
  registerLeadRoutes(app);
  registerLeadDirectoryRoutes(app);
  registerLeadSearchRoutes(app);
  registerCompanyResearchRoutes(app);
  registerProfileEnrichmentRoutes(app);
  registerLeadConversationsRoutes(app);
  registerDatasetImportRoutes(app);
  registerServiceCatalogRoutes(app);
  registerSignalCategoryRoutes(app);
  registerIcpRoutes(app);
  registerPipelineRoutes(app);
  registerAdminRoutes(app);
  registerBalanceRoutes(app);

  return { app, env };
}
