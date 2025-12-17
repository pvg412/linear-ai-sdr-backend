import axios from "axios";
import z from "zod";

import { loadEnv } from "@/config/env";
import { pollUntil } from "@/capabilities/lead-db/shared/polling";
import {
	ScraperCityStartResponseSchema,
	ScraperCityStatusResponseSchema,
	ScraperCityApolloRowSchema,
	type ScraperCityStatusResponse,
	type ScraperCityApolloRow,
} from "./scrapercity.schemas";

const env = loadEnv();

export class ScraperCityClient {
	constructor(private readonly apiKey: string) {}

	private get baseUrl(): string {
		if (!env.SCRAPERCITY_API_URL)
			throw new Error("SCRAPERCITY_API_URL is not set");
		return env.SCRAPERCITY_API_URL.replace(/\/+$/, "");
	}

	async startApolloFilters(payload: Record<string, unknown>): Promise<string> {
		const url = `${this.baseUrl}/v1/scrape/apollo-filters`;

		const res = await axios.post(url, payload, {
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			timeout: 60_000,
		});

		const data = ScraperCityStartResponseSchema.parse(res.data);
		return data.runId;
	}

	async getStatus(runId: string): Promise<ScraperCityStatusResponse> {
		const url = `${this.baseUrl}/v1/scrape/status/${runId}`;

		const res = await axios.get(url, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			timeout: 30_000,
		});

		return ScraperCityStatusResponseSchema.parse(res.data);
	}

	async waitForSucceeded(
		runId: string,
		opts: { intervalMs: number; maxAttempts: number }
	): Promise<ScraperCityStatusResponse> {
		let lastStatus: string | undefined;

		return pollUntil<ScraperCityStatusResponse>({
			intervalMs: opts.intervalMs,
			maxAttempts: opts.maxAttempts,
			task: async (attempt) => {
				const s = await this.getStatus(runId);
				const status = String(s.status ?? "").toUpperCase();

				if (attempt === 1 || status !== lastStatus) {
					console.debug("[ScraperCity] status", { runId, attempt, status });
				}
				lastStatus = status;

				return s;
			},
			isDone: (s) => String(s.status ?? "").toUpperCase() === "SUCCEEDED",
			isError: (s) => {
				const status = String(s.status ?? "").toUpperCase();
				if (status === "FAILED") return `ScraperCity run failed: ${runId}`;
				return false;
			},
		});
	}

	async downloadJsonRows(
		runId: string,
		status?: ScraperCityStatusResponse
	): Promise<ScraperCityApolloRow[]> {
		const downloadUrl = this.buildDownloadUrl(runId, status?.outputUrl);

		const res = await axios.get(downloadUrl, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			timeout: 120_000,
		});

		const data = z.array(ScraperCityApolloRowSchema).parse(res.data);
		return data;
	}

	private buildDownloadUrl(runId: string, outputUrl?: string | null): string {
		const base = this.baseUrl;

		if (outputUrl) {
			const origin = new URL(base).origin;
			const path = outputUrl.startsWith("/") ? outputUrl : `/${outputUrl}`;
			const sep = path.includes("?") ? "&" : "?";
			return `${origin}${path}${sep}format=json`;
		}

		return `${base}/downloads/${runId}?format=json`;
	}
}
