import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AxiosError,
  InternalAxiosRequestConfig,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { LeadProvider } from "@prisma/client";

import {
  SearchLeadsCreateExportResponseSchema,
  SearchLeadsStatusCheckResponseSchema,
  SearchLeadsResultResponseSchema,
  type SearchLeadsLeadRow,
} from "../searchleads.schemas";
import { mapSearchLeadsRowsToLeads } from "../searchleads.leadMapper";
import { validateNormalizedLeads } from "@/capabilities/shared/leadValidate";
import { wrapSearchLeadsAxiosError } from "../searchleads.errors";
import { UserFacingError } from "@/infra/userFacingError";

function fixture(name: string): unknown {
  const p = join(__dirname, "..", "__fixtures__", name);
  return JSON.parse(readFileSync(p, "utf8")) as unknown;
}

function makeAxiosError(status: number, data: unknown): AxiosError {
  const config: AxiosRequestConfig = {
    url: "https://apis.searchleads.co/api/export",
    method: "post",
    headers: {},
  };

  const response: AxiosResponse = {
    status,
    statusText: String(status),
    headers: {},
    config: config as InternalAxiosRequestConfig,
    data,
  };

  return new AxiosError(
    `Request failed with status code ${status}`,
    undefined,
    config as InternalAxiosRequestConfig,
    undefined,
    response,
  );
}

describe("SearchLeads contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses createExport response fixture (Guarantee A)", () => {
    const raw = fixture("createExport.response.json");
    const parsed = SearchLeadsCreateExportResponseSchema.parse(raw);

    expect(parsed.log_id).toBeTypeOf("string");
    expect(parsed.log_id.length).toBeGreaterThan(0);
  });

  it("parses statusCheck fixtures (Guarantee A)", () => {
    const pending = SearchLeadsStatusCheckResponseSchema.parse(
      fixture("statusCheck.pending.json"),
    );
    expect(pending.log.status).toBe("pending");

    const completed = SearchLeadsStatusCheckResponseSchema.parse(
      fixture("statusCheck.completed.json"),
    );
    expect(completed.log.status).toBe("completed");
  });

  it("parses result.completed fixture and maps to valid normalized leads (Guarantee A+B)", () => {
    const parsed = SearchLeadsResultResponseSchema.parse(
      fixture("result.completed.json"),
    );

    expect(parsed.log.status).toBe("completed");
    expect(Array.isArray(parsed.log.data)).toBe(true);

    const rows = parsed.log.data as SearchLeadsLeadRow[];

    const leads = mapSearchLeadsRowsToLeads(rows);

    const validated = validateNormalizedLeads(leads, {
      mode: "strict",
      provider: LeadProvider.SEARCH_LEADS,
      minValid: 1,
    });

    expect(validated.length).toBeGreaterThan(0);
    expect(validated[0]?.email ?? validated[0]?.linkedinUrl).toBeTruthy();
  });

  it("parses result.csv fixture where log.data is a URL string (Guarantee A)", () => {
    const parsed = SearchLeadsResultResponseSchema.parse(fixture("result.csv.json"));

    expect(parsed.log.status).toBe("completed");
    expect(typeof parsed.log.data).toBe("string");
    expect((parsed.log.data as string).includes("export?format=csv")).toBe(true);
  });

  it("wraps 401 into UserFacingError (Guarantee C: error contract)", () => {
    const err = makeAxiosError(401, fixture("error.401.json"));

    expect(() => wrapSearchLeadsAxiosError(err)).toThrow(UserFacingError);

    try {
      wrapSearchLeadsAxiosError(err);
    } catch (e) {
      const uf = e as UserFacingError & { code?: string };
      expect(uf.code).toBe("SEARCHLEADS_UNAUTHORIZED");
    }
  });

  it("wraps 422 into UserFacingError (Guarantee C: error contract)", () => {
    const err = makeAxiosError(422, fixture("error.422.json"));

    expect(() => wrapSearchLeadsAxiosError(err)).toThrow(UserFacingError);

    try {
      wrapSearchLeadsAxiosError(err);
    } catch (e) {
      const uf = e as UserFacingError & { code?: string };
      expect(uf.code).toBe("SEARCHLEADS_INVALID_INPUT");
    }
  });
});
