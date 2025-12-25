import { describe, expect, it } from "vitest";

import { LeadPaginationSchema } from "./schemas/lead.schemas";

describe("LeadPaginationSchema", () => {
	it("accepts optional filters (createdById, email) with pagination", () => {
		const parsed = LeadPaginationSchema.parse({
			leadSearchId: "ckm4j1u2t0000qwertyuiopas",
			createdById: "ckm4j1u2t0001qwertyuiopas",
			email: "test@example.com",
			page: "1",
			perPage: "50",
		});

		expect(parsed).toEqual({
			leadSearchId: "ckm4j1u2t0000qwertyuiopas",
			createdById: "ckm4j1u2t0001qwertyuiopas",
			email: "test@example.com",
			page: 1,
			perPage: 50,
		});
	});

	it("rejects when only one of page/perPage is provided", () => {
		expect(() => LeadPaginationSchema.parse({ page: "1" })).toThrow();
		expect(() => LeadPaginationSchema.parse({ perPage: "50" })).toThrow();
	});
});


