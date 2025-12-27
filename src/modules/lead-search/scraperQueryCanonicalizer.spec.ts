import { describe, expect, it } from "vitest";

import { canonicalizeScraperStoredQuery } from "./scraperQueryCanonicalizer";

describe("canonicalizeScraperStoredQuery", () => {
	it("adds apolloUrl when missing and filters are present", () => {
		const res = canonicalizeScraperStoredQuery({
			storedQuery: {
				industry: "Software",
				titles: ["CTO"],
				locations: ["San Francisco"],
				companySize: "11-50",
			},
			limit: 25,
			leadSearchId: "test_lead_search",
		});

		expect(res.didAddApolloUrl).toBe(true);
		expect(typeof res.canonicalQuery.apolloUrl).toBe("string");
		expect(String(res.canonicalQuery.apolloUrl)).toContain("app.apollo.io");
	});

	it("does not overwrite existing apolloUrl", () => {
		const res = canonicalizeScraperStoredQuery({
			storedQuery: { apolloUrl: "https://example.com", titles: ["CTO"] },
			limit: 25,
		});

		expect(res.didAddApolloUrl).toBe(false);
		expect(res.canonicalQuery.apolloUrl).toBe("https://example.com");
	});
});


