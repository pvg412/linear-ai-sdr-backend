import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { loadEnv } from './config/env';
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
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  registerSearchTaskRoutes(app);
  registerLeadRoutes(app);
  registerTelegramRoutes(app);
  registerScraperRoutes(app);

  return { app, env };
}
