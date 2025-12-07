import { injectable } from "inversify";
import { LeadSource } from "@prisma/client";
import OpenAI from "openai";

import {
	createSearchTaskBodySchema,
	CreateSearchTaskBody,
} from "../search-task/search-task.schemas";

interface ParsePromptInput {
	chatId: string;
	text: string;
}

@injectable()
export class AiPromptParserService {
	private readonly client: OpenAI;

	constructor(private readonly apiKey: string, private readonly model: string) {
		this.client = new OpenAI({ apiKey: this.apiKey });
	}

	async parsePromptToSearchTaskInput(
		input: ParsePromptInput
	): Promise<CreateSearchTaskBody> {
		const systemPrompt = `
You help an SDR assistant turn user requests into lead search parameters.

Extract fields:
- industry: short description like "SaaS", "fintech", "e-commerce". If missing, null.
- titles: array of job titles, e.g. ["CEO", "CTO"].
- locations: array of locations (countries / regions / cities in English).
- companySize: string like "1-10", "11-50", "51-200", "200-1000", "1000+". If missing, null.
- limit: number of leads. If user specified a number, use it, otherwise 100.

Return ONLY valid JSON object with fields:
{ "industry": string | null, "titles": string[], "locations": string[], "companySize": string | null, "limit": number }
`.trim();

		const completion = await this.client.chat.completions.create({
			model: this.model,
			messages: [
				{
					role: "system",
					content: systemPrompt,
				},
				{
					role: "user",
					content: input.text,
				},
			],
			response_format: { type: "json_object" as const },
		});

		const rawJson = completion.choices[0]?.message?.content || "{}";

		const cleanJson = rawJson.replace(/```json\n?|\n?```/g, "").trim();

		const parsed = JSON.parse(cleanJson) as {
			industry?: unknown;
			titles?: unknown;
			locations?: unknown;
			companySize?: unknown;
			limit?: unknown;
		};

		const industry =
			typeof parsed.industry === "string" && parsed.industry.trim().length > 0
				? parsed.industry.trim()
				: undefined;

		const titles = Array.isArray(parsed.titles)
			? parsed.titles.filter(
					(t): t is string => typeof t === "string" && t.trim().length > 0
			  )
			: [];

		const locations = Array.isArray(parsed.locations)
			? parsed.locations.filter(
					(l): l is string => typeof l === "string" && l.trim().length > 0
			  )
			: [];

		const companySize =
			typeof parsed.companySize === "string" &&
			parsed.companySize.trim().length > 0
				? parsed.companySize.trim()
				: undefined;

		const limit =
			typeof parsed.limit === "number" && Number.isFinite(parsed.limit)
				? parsed.limit
				: 100;

		const result = createSearchTaskBodySchema.parse({
			prompt: input.text,
			chatId: input.chatId,
			source: LeadSource.APOLLO,

			industry,
			titles,
			locations,
			companySize,
			limit,
		});
		
		return result;
	}
}
