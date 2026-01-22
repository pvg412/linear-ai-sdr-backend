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
} from "../apify-linkedin-profile-search.schemas";
import { mapApifyLinkedinRowsToLeads } from "../apify-linkedin-profile-search.leadMapper";
import { validateNormalizedLeads } from "../../../../shared/leadValidate";
import { wrapApifyError } from "../apify-linkedin-profile-search.errors";
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

    // Verify that looseObject preserves unknown fields from real API response
    expect((rows[0] as Record<string, unknown>)["websites"]).toBeDefined();
    expect((rows[0] as Record<string, unknown>)["openToWork"]).toBe(false);

    const leads = mapApifyLinkedinRowsToLeads(rows);

    const validated = validateNormalizedLeads(leads, {
      mode: "strict",
      minValid: 1,
    });

    expect(validated.length).toBeGreaterThanOrEqual(1);

    const first = validated[0];
    expect(first.fullName).toBeDefined();
    expect(first.linkedinUrl).toBeDefined();
    expect(first.linkedinUrl).toContain("linkedin.com/in/");
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
