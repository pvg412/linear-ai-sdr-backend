import axios from "axios";

import { loadEnv } from "@/config/env";
import { pollUntil } from "@/capabilities/shared/polling";
import {
  SearchLeadsCreateExportResponseSchema,
  SearchLeadsResultResponseSchema,
  SearchLeadsStatusCheckResponseSchema,
  type SearchLeadsLeadRow,
  type SearchLeadsResultResponse,
  type SearchLeadsStatus,
} from "./searchleads.schemas";
import type { SearchLeadsCreateExportRequest } from "./searchleads.filterMapper";

const env = loadEnv();

export class SearchLeadsClient {
  constructor(private readonly apiKey: string) {}

  private get baseUrl(): string {
    const raw = env.SEARCH_LEADS_API_URL;
    if (!raw) throw new Error("SEARCH_LEADS_API_URL is not set");
    return raw.replace(/\/+$/, "");
  }

  async createExport(payload: SearchLeadsCreateExportRequest): Promise<string> {
    const url = `${this.baseUrl}/api/export`;

    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60_000,
    });

    const parsed = SearchLeadsCreateExportResponseSchema.parse(res.data);
    return parsed.log_id;
  }

  async statusCheck(logId: string): Promise<SearchLeadsStatus> {
    const url = `${this.baseUrl}/api/logs/statusCheck/${logId}`;

    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: 30_000,
    });

    const parsed = SearchLeadsStatusCheckResponseSchema.parse(res.data);
    return parsed.log.status;
  }

  async waitForCompleted(
    logId: string,
    opts: { intervalMs: number; maxAttempts: number },
  ): Promise<void> {
    let last: SearchLeadsStatus | undefined;

    await pollUntil<SearchLeadsStatus>({
      intervalMs: opts.intervalMs,
      maxAttempts: opts.maxAttempts,
      task: async (attempt) => {
        const status = await this.statusCheck(logId);

        if (attempt === 1 || status !== last) {
          console.debug("[SearchLeads] status", { logId, attempt, status });
        }

        last = status;
        return status;
      },
      isDone: (s) => s === "completed",
      isError: (s) => (s === "failed" ? `SearchLeads export failed: ${logId}` : false),
    });
  }

  async getResult(logId: string): Promise<SearchLeadsResultResponse> {
    const url = `${this.baseUrl}/api/logs/${logId}?outputFileFormat=json`;

    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: 120_000,
    });

    return SearchLeadsResultResponseSchema.parse(res.data);
  }

  /**
   * Convenience: ensures completed + json array.
   * Adapter should call THIS, not re-implement it.
   */
  async getCompletedRows(logId: string): Promise<SearchLeadsLeadRow[]> {
    const parsed = await this.getResult(logId);

    if (parsed.log.status !== "completed") {
      throw new Error(
        `SearchLeads: export not completed yet (status=${parsed.log.status})`,
      );
    }

    const data = parsed.log.data;

    if (!Array.isArray(data)) {
      // outputFileFormat=csv/xlsx/pdf -> url string
      throw new Error(
        "SearchLeads: expected JSON array in log.data (outputFileFormat=json)",
      );
    }

    return data;
  }
}
