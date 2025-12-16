import { LeadStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";

import { app } from "@/test/setup";
import { CreateSearchTaskResponse } from "../search-task/search-task.dto";
import { BulkCreateLeadsResponse, GetLeadsByTaskResponse } from "./lead.dto";

describe("Lead Controller", () => {
	it("should save leads for a task and return them", async () => {
		const taskRes = await app.inject({
			method: "POST",
			url: "/search-tasks",
			payload: {
				prompt: "web3 founders in EU",
				chatId: "telegram:123",
				limit: 2,
			},
		});
		expect(taskRes.statusCode).toBe(201);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const task = taskRes.json() as CreateSearchTaskResponse;

		const bulkRes = await app.inject({
			method: "POST",
			url: "/leads/bulk",
			payload: {
				searchTaskId: task.id,
				leads: [
					{
						email: "founder1@example.com",
						fullName: "Alice Web3",
						title: "Founder",
						company: "Web3 Labs",
					},
					{
						email: "founder2@example.com",
						fullName: "Bob Crypto",
						title: "CEO",
						company: "Crypto Inc",
					},
				],
			},
		});

		expect(bulkRes.statusCode).toBe(201);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const bulkResult = bulkRes.json() as BulkCreateLeadsResponse;
		expect(bulkResult.count).toBe(2);

		const listRes = await app.inject({
			method: "GET",
			url: `/search-tasks/${task.id}/leads`,
		});

		expect(listRes.statusCode).toBe(200);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const leads = listRes.json() as GetLeadsByTaskResponse;

		expect(leads).toHaveLength(2);
		expect(leads.map((l) => l.email).sort()).toEqual(
			["founder1@example.com", "founder2@example.com"].sort()
		);
		expect(leads.every((l) => l.status === LeadStatus.NEW)).toBe(true);
	});
});
