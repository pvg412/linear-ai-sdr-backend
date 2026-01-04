import { describe, expect, it } from "vitest";

import { UNASSIGNED_DIRECTORY_ID } from "@/modules/lead-directory/lead-directory.unassigned";
import { buildLeadWhere } from "./lead.repository";

describe("buildLeadWhere", () => {
	it("adds isVerified=true by default", () => {
		const where = buildLeadWhere({ ownerId: "user_1" });
		expect(where).toEqual({ AND: [{ isVerified: true }] });
	});

	it("does not add isVerified=true when includeUnverified=true", () => {
		const where = buildLeadWhere({ ownerId: "user_1", includeUnverified: true });
		expect(where).toEqual({});
	});

	it("supports search across multiple fields (contains, insensitive)", () => {
		const where = buildLeadWhere({
			ownerId: "user_1",
			filters: { search: "Acme" },
		});

		expect(where).toMatchObject({
			AND: [
				{ isVerified: true },
				{
					OR: [
						{ fullName: { contains: "Acme", mode: "insensitive" } },
						{ firstName: { contains: "Acme", mode: "insensitive" } },
						{ lastName: { contains: "Acme", mode: "insensitive" } },
						{ email: { contains: "Acme", mode: "insensitive" } },
						{ title: { contains: "Acme", mode: "insensitive" } },
						{ company: { contains: "Acme", mode: "insensitive" } },
						{ companyDomain: { contains: "Acme", mode: "insensitive" } },
						{ companyUrl: { contains: "Acme", mode: "insensitive" } },
						{ linkedinUrl: { contains: "Acme", mode: "insensitive" } },
						{ location: { contains: "Acme", mode: "insensitive" } },
					],
				},
			],
		});
	});

	it("supports directoryIds with OR semantics (any selected directory)", () => {
		const where = buildLeadWhere({
			ownerId: "user_1",
			filters: { directoryIds: ["dir_a", "dir_b"] },
		});

		expect(where).toMatchObject({
			AND: [
				{ isVerified: true },
				{
					leadDirectoryLeads: {
						some: {
							directoryId: { in: ["dir_a", "dir_b"] },
							directory: { ownerId: "user_1" },
						},
					},
				},
			],
		});
	});

	it("supports directoryIds including UNASSIGNED_DIRECTORY_ID (OR with unassigned)", () => {
		const where = buildLeadWhere({
			ownerId: "user_1",
			filters: { directoryIds: ["dir_a", UNASSIGNED_DIRECTORY_ID] },
		});

		expect(where).toMatchObject({
			AND: [
				{ isVerified: true },
				{
					OR: [
						{
							leadDirectoryLeads: {
								some: {
									directoryId: { in: ["dir_a"] },
									directory: { ownerId: "user_1" },
								},
							},
						},
						{
							leadDirectoryLeads: {
								none: { directory: { ownerId: "user_1" } },
							},
						},
					],
				},
			],
		});
	});
});


