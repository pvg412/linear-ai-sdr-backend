import { injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";

import type {
  SignalProvider,
  SignalSearchInput,
  HiringSignalResult,
} from "@/capabilities/hiring-signals/signal-provider.dto";
import { HirebaseClient } from "./hirebase.client";
import {
  HirebaseRateLimitError,
  wrapHirebaseError,
} from "./hirebase.errors";

/** Opaque key used in DB records. Never shown to the frontend. */
const PROVIDER_KEY = "hirebase";

/**
 * Maximum number of requests per UTC calendar day.
 * Hirebase plan limit: 1,000 requests/day.
 */
const HIREBASE_DAILY_REQUEST_LIMIT = 1_000;

/**
 * Number of recent job listings to request per company.
 * One request per unique company — chosen to balance signal value
 * and quota usage.
 */
const JOBS_PER_REQUEST = 10;

/**
 * Look-back window in days. Jobs posted within this period indicate
 * active hiring. 90 days is conservative enough to catch companies
 * that aren't posting every week but still have open roles.
 */
const DAYS_AGO = 90;

/** Maximum number of job titles to store (avoids bloating the DB). */
const MAX_TOP_JOB_TITLES = 10;

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Hirebase signal provider.
 *
 * Implements one strategy: POST /v2/jobs/search filtered by company_name.
 * Daily request quota is tracked in the `SignalProviderDailyUsage` table
 * and checked atomically before each call via a Prisma upsert.
 */
@injectable()
export class HirebaseProvider implements SignalProvider {
  readonly key = PROVIDER_KEY;

  private readonly client: HirebaseClient;
  private readonly prisma = getPrisma();

  constructor(private readonly apiKey: string) {
    this.client = new HirebaseClient(apiKey);
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  async detectHiringSignals(
    input: SignalSearchInput,
  ): Promise<HiringSignalResult | null> {
    // ── 1. Daily rate-limit check ─────────────────────────────────────
    const limitReached = await this.checkAndIncrementDailyUsage();
    if (limitReached) {
      console.info(
        "[Hirebase] Daily request limit reached — skipping",
        { companyName: input.companyName, date: utcDateString() },
      );
      return null;
    }

    // ── 2. Call Hirebase API ──────────────────────────────────────────
    try {
      const response = await this.client.searchJobs({
        company_name: input.companyName,
        days_ago: DAYS_AGO,
        sort_by: "date posted",
        sort_order: "desc",
        page: 1,
        limit: JOBS_PER_REQUEST,
      });

      console.log(response)

      // ── 3. Map to generic result ────────────────────────────────────
      const jobs = response.jobs ?? [];
      const openJobCount = response.total_count ?? jobs.length;

      const departments = Array.from(
        new Set(jobs.flatMap((j) => j.job_categories ?? [])),
      );

      const topJobTitles = jobs
        .map((j) => j.job_title)
        .filter((t): t is string => Boolean(t))
        .slice(0, MAX_TOP_JOB_TITLES);

      return {
        providerKey: PROVIDER_KEY,
        companyName: input.companyName,
        openJobCount,
        departments,
        topJobTitles,
        rawData: response,
      };
    } catch (e) {
      if (e instanceof HirebaseRateLimitError) {
        // Provider-side 429 — undo our local counter increment and skip
        await this.decrementDailyUsage();
        console.info(
          "[Hirebase] Provider returned 429 — skipping",
          { companyName: input.companyName },
        );
        return null;
      }

      // All other errors: wrap (which logs them), then return null so the
      // pipeline continues without failing.
      wrapHirebaseError(e);
      return null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Atomically increments today's request counter.
   * Returns `true` if the limit was already reached *before* this call
   * (so the caller should skip), `false` if the call may proceed.
   *
   * Uses upsert + re-read so the increment is atomic within a single
   * Postgres transaction. Safe for single-process deployments; a
   * distributed lock would be needed for multi-process scenarios.
   */
  private async checkAndIncrementDailyUsage(): Promise<boolean> {
    const date = utcDateString();

    const updated = await this.prisma.signalProviderDailyUsage.upsert({
      where: { providerKey_date: { providerKey: PROVIDER_KEY, date } },
      create: { providerKey: PROVIDER_KEY, date, requestCount: 1 },
      update: { requestCount: { increment: 1 } },
      select: { requestCount: true },
    });

    // If the value *after* increment already exceeds the limit the
    // previous call had already hit the ceiling.
    return updated.requestCount > HIREBASE_DAILY_REQUEST_LIMIT;
  }

  /** Undo an increment when the provider returns a 429. */
  private async decrementDailyUsage(): Promise<void> {
    const date = utcDateString();
    try {
      await this.prisma.signalProviderDailyUsage.updateMany({
        where: { providerKey: PROVIDER_KEY, date, requestCount: { gt: 0 } },
        data: { requestCount: { decrement: 1 } },
      });
    } catch {
      // Best-effort; a slightly off counter is acceptable.
    }
  }
}
