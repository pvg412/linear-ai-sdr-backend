import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { loadEnv } from '@/config/env';

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const env = loadEnv();

    const adapter = new PrismaPg({
      connectionString: env.DATABASE_URL,
    });

    prisma = new PrismaClient({ adapter });
  }

  return prisma;
}