import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { loadEnv } from './config/env';
import { registerAuthRoutes } from './modules/auth/auth.controller';
import { createAuthGuard } from './modules/auth/auth.guard';
import { AuthService } from './modules/auth/auth.service';
import { registerSearchTaskRoutes } from './modules/search-task/search-task.controller';
import { registerLeadRoutes } from './modules/lead/lead.controller';
import { registerScraperRoutes } from './modules/scraper/scraper.controller';
import { registerTelegramRoutes } from './modules/telegram/telegram.controller';

export async function buildServer() {
  const env = loadEnv();

  const app = Fastify({
    logger: true,
  });

  await app.register(cors);
  await app.register(swagger, {
    openapi: {
      info: { title: 'AI SDR API', version: '1.0.0' },
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
    routePrefix: '/docs',
  });

  // Auth routes first (login stays public)
  registerAuthRoutes(app, env);

  // Ensure at least one admin exists (via env in prod, optional in dev)
  const authService = new AuthService();
  await authService.ensureInitialAdmin(env, app.log);

  // Protect everything else
  app.addHook("onRequest", createAuthGuard(env));

  registerSearchTaskRoutes(app);
  registerLeadRoutes(app);
  registerTelegramRoutes(app);
  registerScraperRoutes(app);

  return { app, env };
}
