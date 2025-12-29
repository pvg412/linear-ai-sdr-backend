import axios from "axios";
import z from "zod";

import { loadEnv } from "@/config/env";
import {
	ScraperCityApolloRowSchema,
	ScraperCityStartResponseSchema,
	ScraperCityStatusResponseSchema,
	type ScraperCityApolloRow,
	type ScraperCityStatusResponse,
} from "./scrapercity.schemas";

const env = loadEnv();

export class ScraperCityClient {
	constructor(private readonly apiKey: string) {}

	private get baseUrl(): string {
		if (!env.SCRAPERCITY_API_URL)
			throw new Error("SCRAPERCITY_API_URL is not set");
		return env.SCRAPERCITY_API_URL.replace(/\/+$/, "");
	}

	async startApolloUrl(payload: {
		url: string;
		count: number;
	}): Promise<string> {
		const url = `${this.baseUrl}/v1/scrape/apollo`;

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

	async downloadJsonRows(
		runId: string,
		status?: ScraperCityStatusResponse
	): Promise<ScraperCityApolloRow[]> {
		const downloadUrl = this.buildDownloadUrl(runId, status?.outputUrl);

		const res = await axios.get(downloadUrl, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			timeout: 120_000,
		});

		return z.array(ScraperCityApolloRowSchema).parse(res.data);
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
