import { describe, expect, it } from "vitest";

import { buildLeadSearchSelectorWhere } from "./lead-search.repository";

describe("buildLeadSearchSelectorWhere", () => {
	it("filters by createdById and excludes lead-searches without leads", () => {
		const where = buildLeadSearchSelectorWhere("user_1");
		expect(where).toEqual({
			createdById: "user_1",
			leads: { some: {} },
		});
	});
});


