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

		vi.spyOn(axios, "get").mockResolvedValue({
			data: csvData,
			status: 200,
		});

		const rows = await client.downloadJsonRows("run-123");

		expect(axios.get).toHaveBeenCalledWith(
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
});
