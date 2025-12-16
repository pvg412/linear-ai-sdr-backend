import { SearchTaskStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";

import { app } from '@/test/setup';
import { CreateSearchTaskResponse, GetSearchTaskResponse } from "./search-task.dto";


describe("SearchTask Controller", () => {
	it("should create a search task and allow it to be fetched", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/search-tasks",
			payload: {
				prompt: "Find web3 founders",
				chatId: "telegram:123",
				limit: 10,
			},
		});

		expect(createRes.statusCode).toBe(201);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const created = createRes.json() as CreateSearchTaskResponse;

		expect(created.id).toBeTypeOf("string");
		expect(created.status).toBe(SearchTaskStatus.PENDING);
		expect(created.prompt).toBe("Find web3 founders");

		const getRes = await app.inject({
			method: "GET",
			url: `/search-tasks/${created.id}`,
		});

		expect(getRes.statusCode).toBe(200);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const fetched = getRes.json() as GetSearchTaskResponse;

		expect(fetched?.id).toBe(created.id);
		expect(fetched?.status).toBe(SearchTaskStatus.PENDING);
	});

	it("should return 404 for a non-existent search task", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/search-tasks/non-existent-id",
		});

		expect(res.statusCode).toBe(404);
	});
});
