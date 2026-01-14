import axios from "axios";
import { parse } from "csv-parse/sync";
import z from "zod";

import { loadEnv } from "@/config/env";
import {
	ScraperCityApolloRowSchema,
	ScraperCityEmailValidationRowSchema,
	ScraperCityStartResponseSchema,
	ScraperCityStatusResponseSchema,
	type ScraperCityApolloRow,
	type ScraperCityEmailValidationRow,
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

	async startEmailValidator(payload: {
		emails: string[];
		timeout?: number;
	}): Promise<string> {
		const url = `${this.baseUrl}/v1/scrape/email-validator`;

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
			responseType: "text",
		});

		if (typeof res.data !== "string") {
			throw new Error("Expected string response from ScraperCity");
		}

		const records = parse(res.data, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as unknown as Record<string, string | undefined>[];

		const rows = records.map((record) => ({
			...record,
			id: record["Person ID"] || record.id,
			firstName: record["First Name"],
			lastName: record["Last Name"],
			fullName: record["Full Name"],
			title: record["Title"],
			linkedinUrl: record["LinkedIn"],
			city: record["City"],
			state: record["State"],
			country: record["Country"],
			email: record["Email"],
			orgName: record["Company Name"],
			orgWebsite: record["Company Website"],
			orgDomain: record["Company Domain"],
		}));

		return z.array(ScraperCityApolloRowSchema).parse(rows);
	}

	async downloadEmailValidationRows(
		runId: string,
		status?: ScraperCityStatusResponse
	): Promise<ScraperCityEmailValidationRow[]> {
		const downloadUrl = this.buildDownloadUrl(runId, status?.outputUrl);

		const res = await axios.get(downloadUrl, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			timeout: 120_000,
			responseType: "text",
		});

		if (typeof res.data !== "string") {
			throw new Error("Expected string response from ScraperCity");
		}

		const records = parse(res.data, {
			columns: true,
			skip_empty_lines: true,
			trim: true,
		}) as unknown as Record<string, string | undefined>[];

		const rows = records.map((record) => ({
			...record,
			// accept both provider-style and "Email" capitalization (just in case)
			email: record.email ?? record.Email,
			email_quality: record.email_quality,
			email_result: record.email_result,
			free: record.free,
			subresult: record.subresult,
		}));

		return z.array(ScraperCityEmailValidationRowSchema).parse(rows);
	}

	private buildDownloadUrl(runId: string, outputUrl?: string | null): string {
		const base = this.baseUrl;

		if (outputUrl) {
			const origin = new URL(base).origin;
			const path = outputUrl.startsWith("/") ? outputUrl : `/${outputUrl}`;
			const sep = path.includes("?") ? "&" : "?";
			return `${origin}${path}${sep}format=csv`;
		}

		return `${base}/downloads/${runId}?format=csv`;
	}
}
