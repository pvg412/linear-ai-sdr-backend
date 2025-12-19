import { describe, test, expect } from "vitest";
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
	// Assumes tests run from repo root
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

	test("rows fixture parses, maps to normalized leads, and passes strict validation (Guarantee A + B)", () => {
		const rowsJson = readFixtureJson("rows.response.json");

		// A: provider row schema validation
		const rows = ScraperCityApolloRowSchema.array().parse(rowsJson);

		// B: mapping + normalization
		const leads = mapScraperCityRowsToLeads(rows);

		// B: strict contract on normalized lead shape
		const validated = validateNormalizedLeads(leads, {
			mode: "strict",
			// provider is used only for logs in drop mode, but ok to set anyway
			// provider: LeadProvider.SCRAPER_CITY,
			minValid: 1,
		});

		expect(validated.length).toBeGreaterThan(0);

		// Extra checks: normalization behavior is stable
		const alice = validated[0];
		expect(alice.companyDomain).toBe("example.com");
		expect(alice.linkedinUrl).toBe(
			"https://www.linkedin.com/in/alice-example/"
		);

		const bob = validated[1];
		expect(bob.companyDomain).toBe("builder.io"); // www removed
	});

	test("invalid-input fixture is wrapped into UserFacingError (Guarantee C for negative path)", () => {
		const errorData = readFixtureJson("error.invalid-input.response.json");

		const axErr = new AxiosError("Request failed with status code 400");
		// Patch required fields used by wrapScraperCityAxiosError()
		(axErr as { response: { status: number; data: unknown } }).response = {
			status: 400,
			data: errorData,
		};
		(axErr as { config: { method: string; url: string; params: unknown; data: unknown } }).config = {
			method: "post",
			url: "https://app.scrapercity.com/api/v1/scrape/apollo-filters",
			params: undefined,
			data: '{"count":500}',
		};

		expect(() => wrapScraperCityAxiosError(axErr)).toThrow(UserFacingError);
	});
});
