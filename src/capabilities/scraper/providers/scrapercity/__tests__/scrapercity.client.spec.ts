import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { ScraperCityClient } from "../scrapercity.client";

describe("ScraperCityClient", () => {
	const apiKey = "test-key";
	let client: ScraperCityClient;

	beforeEach(() => {
		process.env.SCRAPERCITY_API_URL = "https://test.scrapercity.com";
		client = new ScraperCityClient(apiKey);
		vi.resetAllMocks();
	});

	it("downloadJsonRows fetches and parses CSV", async () => {
		const csvData = `First Name,Last Name,Company Name,Company Website,Email,LinkedIn,Title,City,State,Country,Person ID
John,Doe,Acme Inc,https://acme.com,john@acme.com,https://linkedin.com/in/johndoe,CEO,New York,NY,USA,12345`;

		const getSpy = vi.spyOn(axios, "get").mockResolvedValue({
			data: csvData,
			status: 200,
		});

		const rows = await client.downloadJsonRows("run-123");

		expect(getSpy).toHaveBeenCalledWith(
			expect.stringContaining("format=csv"),
			expect.objectContaining({ responseType: "text" })
		);

		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.firstName).toBe("John");
		expect(row.lastName).toBe("Doe");
		expect(row.orgName).toBe("Acme Inc");
		expect(row.orgWebsite).toBe("https://acme.com");
		expect(row.email).toBe("john@acme.com");
		expect(row.linkedinUrl).toBe("https://linkedin.com/in/johndoe");
		expect(row.title).toBe("CEO");
		expect(row.city).toBe("New York");
		expect(row.state).toBe("NY");
		expect(row.country).toBe("USA");
		expect(row.id).toBe("12345");
	});

	it("startEmailValidator posts payload and returns runId", async () => {
		const postSpy = vi.spyOn(axios, "post").mockResolvedValue({
			data: { runId: "email-run-123" },
			status: 200,
		});

		const runId = await client.startEmailValidator({
			emails: ["john@example.com", "jane@company.com"],
			timeout: 10,
		});

		expect(postSpy).toHaveBeenCalledWith(
			expect.stringContaining("/v1/scrape/email-validator"),
			expect.objectContaining({
				emails: ["john@example.com", "jane@company.com"],
				timeout: 10,
			}),
			expect.any(Object)
		);
		expect(runId).toBe("email-run-123");
	});

	it("downloadEmailValidationRows fetches and parses email-validator CSV", async () => {
		const csvData = `email,email_quality,email_result,free,subresult
duncanwong@cryptoblk.io,good,ok,FALSE,ok`;

		const getSpy = vi.spyOn(axios, "get").mockResolvedValue({
			data: csvData,
			status: 200,
		});

		const rows = await client.downloadEmailValidationRows("run-ev-1");

		expect(getSpy).toHaveBeenCalledWith(
			expect.stringContaining("format=csv"),
			expect.objectContaining({ responseType: "text" })
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.email).toBe("duncanwong@cryptoblk.io");
		expect(rows[0]?.email_quality).toBe("good");
		expect(rows[0]?.email_result).toBe("ok");
		expect(String(rows[0]?.free)).toMatch(/false/i);
		expect(rows[0]?.subresult).toBe("ok");
	});
});
