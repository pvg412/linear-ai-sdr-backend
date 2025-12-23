import { describe, test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AxiosError } from "axios";

import {
	ScraperCityApolloRowSchema,
	ScraperCityStartResponseSchema,
	ScraperCityStatusResponseSchema,
} from "../scrapercity.schemas";
import { mapScraperCityRowsToLeads } from "../scrapercity.leadMapper";
import { validateNormalizedLeads } from "../../../../shared/leadValidate";
import { wrapScraperCityAxiosError } from "../scrapercity.errors";
import { UserFacingError } from "@/infra/userFacingError";

// English comments by request
function readFixtureJson<T = unknown>(fileName: string): T {
	const fixturesDir = path.join(
		process.cwd(),
		"src",
		"capabilities",
		"lead-db",
		"providers",
		"scrapercity",
		"__fixtures__"
	);

	const filePath = path.join(fixturesDir, fileName);
	return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("ScraperCity contract (fixtures)", () => {
	test("start/status fixtures parse with Zod schemas (Guarantee A)", () => {
		const start = readFixtureJson("startApolloFilters.response.json");
		const status = readFixtureJson("statusSucceeded.response.json");

		expect(() => ScraperCityStartResponseSchema.parse(start)).not.toThrow();
		expect(() => ScraperCityStatusResponseSchema.parse(status)).not.toThrow();
	});

	const ROW_FIXTURES = [
		"rows.snake.response.json",
		"rows.camel.response.json",
	] as const;

	for (const fileName of ROW_FIXTURES) {
		test(`rows fixture '${fileName}' parses, maps, and passes strict validation (Guarantee A + B)`, () => {
			const rowsJson = readFixtureJson(fileName);

			// A: provider row schema validation
			const rows = ScraperCityApolloRowSchema.array().parse(rowsJson);

			// Ensure passthrough keeps unknown fields
			expect(
				(rows[0] as Record<string, unknown>)["some_unknown_field_from_provider"]
			).toBe("keep_me");
			expect(
				(rows[1] as Record<string, unknown>)["another_unknown_field"]
			).toBe(123);

			// B: mapping + normalization
			const leads = mapScraperCityRowsToLeads(rows);

			// B: strict contract on normalized lead shape
			const validated = validateNormalizedLeads(leads, {
				mode: "strict",
				minValid: 2,
			});

			expect(validated.length).toBe(2);

			const alice = validated[0];
			expect(alice.company).toBe("Example GmbH");
			expect(alice.companyDomain).toBe("example.com");
			expect(alice.companyUrl).toBe("https://example.com");
			expect(alice.title).toBe("Chief Technology Officer");
			expect(alice.email).toBe("alice@example.com");
			expect(alice.linkedinUrl).toBe(
				"https://www.linkedin.com/in/alice-example/"
			);

			const bob = validated[1];
			expect(bob.fullName).toBeTruthy();
			expect(bob.company).toBe("Builder AG");
			expect(bob.companyDomain).toBe("builder.io"); // www removed
			expect(bob.companyUrl).toBe("https://builder.io");
			expect(bob.title).toBe("CTO");
			expect(bob.linkedinUrl).toBe("https://www.linkedin.com/in/bob-builder/");
		});
	}

	test("invalid-input fixture is wrapped into UserFacingError (Guarantee C for negative path)", () => {
		const errorData = readFixtureJson("error.invalid-input.response.json");

		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const axErr = new AxiosError("Request failed with status code 400");
			(
				axErr as unknown as { response: { status: number; data: unknown } }
			).response = {
				status: 400,
				data: errorData,
			};
			(
				axErr as unknown as {
					config: {
						method: string;
						url: string;
						params: unknown;
						data: unknown;
					};
				}
			).config = {
				method: "post",
				url: "https://app.scrapercity.com/api/v1/scrape/apollo-filters",
				params: undefined,
				data: '{"count":500}',
			};

			expect(() => wrapScraperCityAxiosError(axErr)).toThrow(UserFacingError);
		} finally {
			errSpy.mockRestore();
		}
	});
});
