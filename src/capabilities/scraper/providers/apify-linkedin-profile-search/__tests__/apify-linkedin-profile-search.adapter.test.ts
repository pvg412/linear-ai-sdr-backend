import { describe, expect, test, vi } from "vitest";

const getRunMock = vi.fn();
const startMock = vi.fn();
const getDatasetItemCountMock = vi.fn();
const getDatasetLastItemMock = vi.fn();

vi.mock("../apify-linkedin-profile-search.client", () => {
  return {
    // Must be constructible: ApifyScraperAdapter does `new ApifyLinkedinProfileSearchClient(...)`.
    ApifyLinkedinProfileSearchClient: class ApifyLinkedinProfileSearchClient {
      public start = startMock;
      public getRun = getRunMock;
      public listDatasetItems = vi.fn();
      public getDatasetItemCount = getDatasetItemCountMock;
      public getDatasetLastItem = getDatasetLastItemMock;

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

    const { ApifyLinkedinProfileSearchScraperAdapter } =
      await import("../apify-linkedin-profile-search.adapter");
    const adapter = new ApifyLinkedinProfileSearchScraperAdapter(
      "token",
      true,
      "mongodb://localhost:27017",
      true,
    );

    const res = await adapter.checkStatus("run_1");
    expect(res.status).toBe("FAILED");
    expect((res.raw as Record<string, unknown>)["_hint"]).toBe(
      "RATE_LIMITED_PARTIAL",
    );
  });

  test("keeps normal SUCCEEDED as SUCCEEDED", async () => {
    getRunMock.mockResolvedValueOnce({
      id: "run_2",
      status: "SUCCEEDED",
      statusMessage: "Finished",
      defaultDatasetId: "ds_2",
    });

    const { ApifyLinkedinProfileSearchScraperAdapter } =
      await import("../apify-linkedin-profile-search.adapter");
    const adapter = new ApifyLinkedinProfileSearchScraperAdapter(
      "token",
      true,
      "mongodb://localhost:27017",
      true,
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

    const { ApifyLinkedinProfileSearchScraperAdapter } =
      await import("../apify-linkedin-profile-search.adapter");
    const adapter = new ApifyLinkedinProfileSearchScraperAdapter(
      "token",
      true,
      "mongodb://localhost:27017",
      true,
    );

    const res = await adapter.checkStatus("run_3");
    expect(res.status).toBe("FAILED");
  });
});

describe("ApifyScraperAdapter.getRateLimitResumePlan()", () => {
  test("computes nextStartPage/remainingTakePages from dataset meta pageNumber", async () => {
    getRunMock.mockResolvedValueOnce({
      id: "run_10",
      status: "SUCCEEDED",
      statusMessage: "Rate limited",
      defaultDatasetId: "ds_10",
    });

    getDatasetItemCountMock.mockResolvedValueOnce(75);
    getDatasetLastItemMock.mockResolvedValueOnce({
      id: "x",
      _meta: { pagination: { pageNumber: 3 } },
    });

    const { ApifyLinkedinProfileSearchScraperAdapter, msUntilNextHour } =
      await import("../apify-linkedin-profile-search.adapter");
    const adapter = new ApifyLinkedinProfileSearchScraperAdapter(
      "token",
      true,
      "mongodb://localhost:27017",
      true,
    );

    const now = new Date("2026-01-19T10:35:43.128Z");
    const plan = await adapter.getRateLimitResumePlan({
      providerRunId: "run_10",
      query: { limit: 250, titles: [], locations: [] },
      now,
    });

    expect(plan.datasetItemCount).toBe(75);
    expect(plan.lastScrapedPage).toBe(3);
    expect(plan.nextStartPage).toBe(4);
    expect(plan.remainingTakePages).toBe(7);
    expect(plan.waitMs).toBe(msUntilNextHour(now));
  });
});
