import axios from "axios";

import { sleep } from "@/capabilities/shared/polling";
import type { SearchLeadsLimiter } from "./searchleads.limiter";
import {
  SearchLeadsCreateExportResponseSchema,
  SearchLeadsResultResponseSchema,
  SearchLeadsStatusCheckResponseSchema,
  type SearchLeadsLeadRow,
  type SearchLeadsResultResponse,
  type SearchLeadsStatus,
} from "./searchleads.schemas";
import type { SearchLeadsCreateExportRequest } from "./searchleads.filterMapper";

const SEARCHLEADS_502_BACKOFF_MINUTES = [1, 3, 5, 10, 15, 20] as const; // sums to 54m
const SEARCHLEADS_502_MAX_TOTAL_MS = 60 * 60 * 1000; // 1h

function getAxiosStatus(e: unknown): number | undefined {
  if (!axios.isAxiosError(e)) return undefined;
  return e.response?.status;
}

export class SearchLeadsClient {
  constructor(
    private readonly apiKey: string,
    private readonly limiter?: SearchLeadsLimiter,
    private readonly apiUrlOverride?: string,
  ) {}

  private get baseUrl(): string {
    // Resolve lazily so tests can stub env vars after imports.
    const raw = this.apiUrlOverride ?? process.env.SEARCH_LEADS_API_URL;
    if (!raw) throw new Error("SEARCH_LEADS_API_URL is not set");
    return raw.replace(/\/+$/, "");
  }

  async createExport(payload: SearchLeadsCreateExportRequest): Promise<string> {
    const url = `${this.baseUrl}/export`;

    if (this.limiter) await this.limiter.waitForRequestSlot();
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
    const url = `${this.baseUrl}/logs/statusCheck/${logId}`;

    if (this.limiter) await this.limiter.waitForRequestSlot();
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
    const retry502DeadlineMs = Date.now() + SEARCHLEADS_502_MAX_TOTAL_MS;

    let last: SearchLeadsStatus | undefined;
    let successfulChecks = 0;
    let retry502Index = 0;

    while (successfulChecks < opts.maxAttempts) {
      try {
        successfulChecks += 1;
        const status = await this.statusCheck(logId);

        // Reset 502 backoff on a successful call.
        retry502Index = 0;

        if (successfulChecks === 1 || status !== last) {
          console.debug("[SearchLeads] status", {
            logId,
            attempt: successfulChecks,
            status,
          });
        }

        last = status;

        if (status === "failed") {
          throw new Error(`SearchLeads export failed: ${logId}`);
        }

        if (status === "completed") return;

        await sleep(opts.intervalMs);
      } catch (e) {
        const status = getAxiosStatus(e);
        if (status !== 502) throw e;

        // Do not count 502 failures towards successfulChecks budget.
        successfulChecks -= 1;

        const nowMs = Date.now();
        if (nowMs >= retry502DeadlineMs) {
          throw new Error(
            `SearchLeads: statusCheck returned 502 for too long (>${Math.round(
              SEARCHLEADS_502_MAX_TOTAL_MS / 60_000,
            )}m): ${logId}`,
          );
        }

        const backoffMinutes =
          SEARCHLEADS_502_BACKOFF_MINUTES[
            Math.min(retry502Index, SEARCHLEADS_502_BACKOFF_MINUTES.length - 1)
          ];
        retry502Index += 1;

        const backoffMs = backoffMinutes * 60_000;
        const remainingMs = retry502DeadlineMs - nowMs;

        console.warn("[SearchLeads] 502 from statusCheck; retrying", {
          logId,
          backoffMinutes,
          remainingSeconds: Math.round(remainingMs / 1000),
        });

        await sleep(Math.min(backoffMs, remainingMs));
      }
    }

    throw new Error(
      `SearchLeads: export not completed yet after ${opts.maxAttempts} successful status checks (logId=${logId})`,
    );
  }

  async getResult(logId: string): Promise<SearchLeadsResultResponse> {
    const url = `${this.baseUrl}/logs/${logId}?outputFileFormat=json`;

    if (this.limiter) await this.limiter.waitForRequestSlot();
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
