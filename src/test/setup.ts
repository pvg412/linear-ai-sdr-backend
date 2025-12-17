import { beforeAll, afterAll, beforeEach } from "vitest";
import * as dotenv from "dotenv";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { execSync } from "node:child_process";

dotenv.config({ path: ".env.test" });

let app: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
	// Ensure the test DB schema matches the current Prisma schema.
	// `migrate deploy` is non-interactive and safe for CI/tests.
	execSync("pnpm exec prisma migrate deploy", { stdio: "inherit" });

	const { buildServer } = await import("../server");
	const server = await buildServer();
	app = server.app;

	const { getPrisma } = await import("../infra/prisma");
	prisma = getPrisma();
});

beforeEach(async () => {
	if (!prisma) return;
	await prisma.$transaction([
		prisma.lead.deleteMany(),
		prisma.searchTask.deleteMany(),
		prisma.campaign.deleteMany(),
	]);
});

afterAll(async () => {
	if (prisma) await prisma.$disconnect();
	if (app) await app.close();
});

export { app };
