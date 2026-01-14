import { injectable } from "inversify";
import { LeadProvider } from "@prisma/client";

import type {
	ScrapeQuery,
	ScraperAdapter,
	ScraperStartResult,
	ScraperStatusResult,
} from "@/capabilities/scraper/scraper.dto";
import {
	validateNormalizedLeads,
	type NormalizedLead,
} from "@/capabilities/shared/leadValidate";
import { pollUntil } from "@/capabilities/shared/polling";

import { ScraperCityClient } from "./scrapercity.client";
import { mapScraperCityRowsToLeads } from "./scrapercity.leadMapper";
import { wrapScraperCityAxiosError } from "./scrapercity.errors";
import { ScraperCityStatusResponseSchema } from "./scrapercity.schemas";
import { normalizeScraperCityEmailResult } from "./scrapercity.emailStatus";

@injectable()
export class ScraperCityScraperAdapter implements ScraperAdapter {
	public readonly provider = LeadProvider.SCRAPER_CITY;

	// 30 minutes
	public readonly pollIntervalMs = 30 * 60 * 1000;

	// 180 * 30min = 90 hours
	public readonly maxPollAttempts = 180;

	private readonly client: ScraperCityClient;

	constructor(
		private readonly apiKey: string,
		private readonly enabled: boolean
	) {
		this.client = new ScraperCityClient(apiKey);
	}

	isEnabled(): boolean {
		return this.enabled && !!this.apiKey;
	}

	async start(query: ScrapeQuery): Promise<ScraperStartResult> {
		try {
			const count = normalizeCount(query.limit);

			const runId = await this.client.startApolloUrl({
				url: query.apolloUrl,
				count,
			});

			return {
				providerRunId: runId,
				fileNameHint: `scrapercity-${runId}.json`,
			};
		} catch (e) {
			wrapScraperCityAxiosError(e);
			throw e;
		}
	}

	async checkStatus(providerRunId: string): Promise<ScraperStatusResult> {
		try {
			const s = await this.client.getStatus(providerRunId);
			const status = String(s.status ?? "").toUpperCase();

			if (status === "SUCCEEDED" || status === "SUCCESS") {
				return { status: "SUCCEEDED", raw: s };
			}
			if (status === "FAILED") {
				return { status: "FAILED", raw: s };
			}

			return { status: "RUNNING", raw: s };
		} catch (e) {
			wrapScraperCityAxiosError(e);
			throw e;
		}
	}

	async fetchLeads(input: {
		providerRunId: string;
		query: ScrapeQuery;
		status?: ScraperStatusResult;
	}): Promise<NormalizedLead[]> {
		try {
			// Prefer status.raw if it matches schema (contains outputUrl), otherwise refetch status.
			// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
			const statusObj: unknown | undefined = input.status?.raw;
			const parsed = statusObj
				? ScraperCityStatusResponseSchema.safeParse(statusObj)
				: { success: false as const };

			const statusForDownload = parsed.success
				? parsed.data
				: await this.client.getStatus(input.providerRunId);

			const rows = await this.client.downloadJsonRows(
				input.providerRunId,
				statusForDownload
			);

			const leadsRaw = mapScraperCityRowsToLeads(rows);
			const leadsValidated = validateNormalizedLeads(leadsRaw, {
				mode: "drop",
				provider: LeadProvider.SCRAPER_CITY,
				minValid: 0,
			});

			// return strictly query.limit
			const limited = leadsValidated.slice(0, input.query.limit);

			// Email validation is best-effort: do not fail whole scrape if validator is down.
			await this.tryEnrichEmailStatuses(limited);

			return limited;
		} catch (e) {
			wrapScraperCityAxiosError(e);
			throw e;
		}
	}

	private async tryEnrichEmailStatuses(leads: NormalizedLead[]): Promise<void> {
		const emails = Array.from(
			new Set(
				leads
					.map((l) =>
						typeof l.email === "string" ? l.email.trim().toLowerCase() : ""
					)
					.filter((e) => e.length > 0)
			)
		);

		if (emails.length === 0) return;

		const CHUNK_SIZE = 500;
		const TIMEOUT_PER_EMAIL_SECS = 10;

		for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
			const chunk = emails.slice(i, i + CHUNK_SIZE);

			try {
				const runId = await this.client.startEmailValidator({
					emails: chunk,
					timeout: TIMEOUT_PER_EMAIL_SECS,
				});

				const status = await pollUntil({
					intervalMs: 2_000,
					maxAttempts: 300, // ~10 min
					task: async () => this.client.getStatus(runId),
					isDone: (s) => {
						const v = String(s.status ?? "").toUpperCase();
						return v === "SUCCEEDED" || v === "SUCCESS";
					},
					isError: (s) => {
						const v = String(s.status ?? "").toUpperCase();
						return v === "FAILED" ? `ScraperCity email-validator failed: ${runId}` : false;
					},
				});

				const rows = await this.client.downloadEmailValidationRows(runId, status);

				const byEmail = new Map<string, NormalizedLead["emailStatus"]>();
				for (const r of rows) {
					const email =
						typeof r.email === "string" ? r.email.trim().toLowerCase() : undefined;
					if (!email) continue;
					byEmail.set(email, normalizeScraperCityEmailResult(r.email_result));
				}

				for (const lead of leads) {
					const email =
						typeof lead.email === "string"
							? lead.email.trim().toLowerCase()
							: undefined;
					if (!email) continue;

					const st = byEmail.get(email);
					if (st) lead.emailStatus = st;
				}
			} catch (e) {
				// best-effort
				console.warn("[ScraperCityScraper] email validation failed; continuing", {
					err: e instanceof Error ? e.message : String(e),
					emails: chunk.length,
				});
			}
		}
	}
}

function normalizeCount(limit: number): number {
	// ScraperCity often doesn't like small values
	const min = 500;
	const max = 50_000;
	const n = Number.isFinite(limit) ? Math.floor(limit) : min;
	if (n < min) return min;
	if (n > max) return max;
	return n;
}
