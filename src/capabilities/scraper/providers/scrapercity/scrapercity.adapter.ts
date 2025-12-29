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

import { ScraperCityClient } from "./scrapercity.client";
import { mapScraperCityRowsToLeads } from "./scrapercity.leadMapper";
import { wrapScraperCityAxiosError } from "./scrapercity.errors";
import { ScraperCityStatusResponseSchema } from "./scrapercity.schemas";

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
			return leadsValidated.slice(0, input.query.limit);
		} catch (e) {
			wrapScraperCityAxiosError(e);
			throw e;
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
