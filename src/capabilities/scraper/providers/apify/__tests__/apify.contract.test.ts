import { describe, test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	AxiosHeaders,
	type AxiosRequestHeaders,
	type AxiosResponse,
	type InternalAxiosRequestConfig,
} from "axios";
import { ApifyApiError } from "apify-client";

import {
	ApifyActorRunSchema,
	ApifyLinkedinProfileRowSchema,
} from "../apify.schemas";
import { mapApifyLinkedinRowsToLeads } from "../apify.leadMapper";
import { validateNormalizedLeads } from "../../../../shared/leadValidate";
import { wrapApifyError } from "../apify.errors";
import { UserFacingError } from "@/infra/userFacingError";

function readFixtureJson<T = unknown>(fileName: string): T {
	const fixturesDir = path.join(__dirname, "..", "__fixtures__");
	const filePath = path.join(fixturesDir, fileName);
	return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("Apify LinkedIn profile search contract (fixtures)", () => {
	test("run fixtures parse with Zod schemas", () => {
		const started = readFixtureJson("run.started.response.json");
		const succeeded = readFixtureJson("run.succeeded.response.json");

		expect(() => ApifyActorRunSchema.parse(started)).not.toThrow();
		expect(() => ApifyActorRunSchema.parse(succeeded)).not.toThrow();
	});

	test("rows fixture parses, maps, and passes strict validation", () => {
		const rowsJson = readFixtureJson("rows.response.json");

		const rows = ApifyLinkedinProfileRowSchema.array().parse(rowsJson);

		expect(
			(rows[0] as Record<string, unknown>)["some_unknown_field"]
		).toBe("keep_me");

		const leads = mapApifyLinkedinRowsToLeads(rows);

		const validated = validateNormalizedLeads(leads, {
			mode: "strict",
			minValid: 2,
		});

		expect(validated.length).toBe(2);

		const alice = validated[0];
		expect(alice.fullName).toBe("Alice Example");
		expect(alice.company).toBe("Example GmbH");
		expect(alice.companyUrl).toBe(
			"https://www.linkedin.com/company/example-gmbh/"
		);
		expect(alice.companyDomain).toBeUndefined();
		expect(alice.title).toBe("Chief Technology Officer");
		expect(alice.email).toBe("alice@example.com");
		expect(alice.linkedinUrl).toBe(
			"https://www.linkedin.com/in/alice-example/"
		);

		const bob = validated[1];
		expect(bob.fullName).toBe("Bob Builder");
		expect(bob.company).toBe("Builder AG");
		expect(bob.companyDomain).toBe("builder.io");
		expect(bob.title).toBe("CTO");
		expect(bob.email).toBe("bob@builder.io");
		expect(bob.linkedinUrl).toBe(
			"https://www.linkedin.com/in/bob-builder/"
		);
	});

	test("unauthorized fixture is wrapped into UserFacingError", () => {
		const errorData = readFixtureJson("error.unauthorized.response.json");

		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const headers = AxiosHeaders.from({}) as unknown as AxiosRequestHeaders;

			const config: InternalAxiosRequestConfig = {
				headers,
				method: "post",
				url: "https://api.apify.com/v2/acts/harvestapi~linkedin-profile-search/runs",
				params: undefined,
				data: "{}",
			};

			const response: AxiosResponse = {
				status: 401,
				data: errorData,
				statusText: "Unauthorized",
				headers: {},
				config,
			};

			const apifyErr = new ApifyApiError(response, 1);

			expect(() => wrapApifyError(apifyErr)).toThrow(UserFacingError);
		} finally {
			errSpy.mockRestore();
		}
	});
});
