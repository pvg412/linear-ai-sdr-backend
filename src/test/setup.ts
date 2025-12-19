import { beforeAll, afterAll, beforeEach } from "vitest";
import * as dotenv from "dotenv";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { execSync } from "node:child_process";

dotenv.config({ path: ".env.test" });

let app: FastifyInstance;
let prisma: PrismaClient;

beforeAll(async () => {
	// IMPORTANT:
	// If Vitest runs multiple workers, this will run per worker.
	// Prefer running tests single-threaded or give each worker its own DB/schema.
	execSync("pnpm exec prisma migrate deploy", { stdio: "inherit" });

	const { buildServer } = await import("../server");
	const server = await buildServer();
	app = server.app;

	const { getPrisma } = await import("../infra/prisma");
	prisma = getPrisma();

	// Seed provider capabilities (required by LeadSearch.capability relation)
	// Keep minimal set you actually support right now.
	const { LeadProvider, LeadSearchKind } = await import("@prisma/client");

	await prisma.leadProviderCapability.createMany({
		data: [
			{
				provider: LeadProvider.SCRAPER_CITY,
				kind: LeadSearchKind.LEAD_DB,
				label: "ScraperCity (Lead DB)",
			},
			{
				provider: LeadProvider.SCRAPER_CITY,
				kind: LeadSearchKind.SCRAPER,
				label: "ScraperCity (Scraper)",
			},
			{
				provider: LeadProvider.SEARCH_LEADS,
				kind: LeadSearchKind.LEAD_DB,
				label: "SearchLeads (Lead DB)",
			},
		],
		skipDuplicates: true,
	});
});

beforeEach(async () => {
	if (!prisma) return;

	// Clean in FK-safe order (children -> parents)
	await prisma.$transaction([
		prisma.chatMessage.deleteMany(),
		prisma.chatThread.deleteMany(),
		prisma.chatFolder.deleteMany(),

		prisma.leadSearchRunResult.deleteMany(),
		prisma.leadSearchRun.deleteMany(),
		prisma.leadSearchLead.deleteMany(),

		prisma.leadProviderRef.deleteMany(),
		prisma.lead.deleteMany(),

		prisma.leadSearch.deleteMany(),

		// Intentionally NOT deleting:
		// prisma.user.deleteMany()
		// prisma.leadProviderCapability.deleteMany()
	]);
});

afterAll(async () => {
	if (prisma) await prisma.$disconnect();
	if (app) await app.close();
});

export { app, prisma };
