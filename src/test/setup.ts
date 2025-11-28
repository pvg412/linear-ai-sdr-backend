import { beforeAll, afterAll, beforeEach } from 'vitest';
import * as dotenv from 'dotenv';

import { getPrisma } from '../infra/prisma';
import { buildServer } from '../server';

dotenv.config({ path: '.env.test' });

let app: Awaited<ReturnType<typeof buildServer>>['app'];

beforeAll(async () => {
  const server = await buildServer();
  app = server.app;
});

beforeEach(async () => {
  const prisma = getPrisma();

  await prisma.$transaction([
    prisma.lead.deleteMany(),
    prisma.searchTask.deleteMany(),
    prisma.campaign.deleteMany(),
  ]);
});

afterAll(async () => {
  const prisma = getPrisma();
  await prisma.$disconnect();
  await app.close();
});

export { app };
