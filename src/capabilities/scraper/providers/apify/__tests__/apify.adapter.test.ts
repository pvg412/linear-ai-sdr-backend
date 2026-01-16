import { describe, expect, test, vi } from "vitest";

const getRunMock = vi.fn();
const startMock = vi.fn();

vi.mock("../apify.client", () => {
	return {
		// Must be constructible: ApifyScraperAdapter does `new ApifyLinkedinProfileSearchClient(...)`.
		ApifyLinkedinProfileSearchClient: class ApifyLinkedinProfileSearchClient {
			public start = startMock;
			public getRun = getRunMock;
			public listDatasetItems = vi.fn();

			constructor(_token: string) {
				// no-op
			}
		},
	};
});

describe("ApifyScraperAdapter.checkStatus()", () => {
	test("marks SUCCEEDED + rate limited statusMessage as FAILED with hint", async () => {
		getRunMock.mockResolvedValueOnce({
			id: "run_1",
			status: "SUCCEEDED",
			statusMessage: "Rate limited, stopping early",
			defaultDatasetId: "ds_1",
		});

		const { ApifyScraperAdapter } = await import("../apify.adapter");
		const adapter = new ApifyScraperAdapter(
			"token",
			true,
			"mongodb://localhost:27017"
		);

		const res = await adapter.checkStatus("run_1");
		expect(res.status).toBe("FAILED");
		expect((res.raw as Record<string, unknown>)["_hint"]).toBe(
			"RATE_LIMITED_PARTIAL"
		);
	});

	test("keeps normal SUCCEEDED as SUCCEEDED", async () => {
		getRunMock.mockResolvedValueOnce({
			id: "run_2",
			status: "SUCCEEDED",
			statusMessage: "Finished",
			defaultDatasetId: "ds_2",
		});

		const { ApifyScraperAdapter } = await import("../apify.adapter");
		const adapter = new ApifyScraperAdapter(
			"token",
			true,
			"mongodb://localhost:27017"
		);

		const res = await adapter.checkStatus("run_2");
		expect(res.status).toBe("SUCCEEDED");
	});

	test("handles rate limit wording variations (rate limit)", async () => {
		getRunMock.mockResolvedValueOnce({
			id: "run_3",
			status: "SUCCEEDED",
			statusMessage: "RATE LIMIT reached. Please retry later.",
			defaultDatasetId: "ds_3",
		});

		const { ApifyScraperAdapter } = await import("../apify.adapter");
		const adapter = new ApifyScraperAdapter(
			"token",
			true,
			"mongodb://localhost:27017"
		);

		const res = await adapter.checkStatus("run_3");
		expect(res.status).toBe("FAILED");
	});
});