import { injectable } from "inversify";
import { LeadSource } from "@prisma/client";
import OpenAI from "openai";

import {
	leadDbFiltersSchema,
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
You convert user requests into lead search parameters for two pipelines:
1) Scraping pipeline (generic): industry, titles, locations, companySize, limit
2) Lead DB pipeline (Apollo-style filters): leadDbFilters object

Rules:
- Return ONLY valid JSON.
- locations must be in English.
- companySize must be one of: "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+" if possible.
- limit: if user specifies a number, use it, otherwise 100.

leadDbFilters must match these keys only (omit unknown keys):
{
  "seniorityLevel"?: string,
  "functionDept"?: string,
  "personTitles"?: string[],
  "personCountry"?: string,
  "personState"?: string,
  "personCities"?: string[],
  "companyIndustry"?: string,
  "companySize"?: string,
  "companyCountry"?: string,
  "companyState"?: string,
  "companyCities"?: string[],
  "companyDomains"?: string[],
  "companyKeywords"?: string[],
  "hasPhone"?: boolean
}

Guidance:
- Use personTitles for job titles (can include variants like CEO/Chief Executive Officer).
- If user mentions keywords like "crypto/web3/blockchain", put them into companyKeywords.
- If location is a country -> personCountry.
- If location is a city -> personCities and also set personCountry if obvious, else omit.
`.trim();

		const completion = await this.client.chat.completions.create({
			model: this.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: input.text },
			],
			response_format: { type: "json_object" as const },
		});

		const rawJson = completion.choices[0]?.message?.content || "{}";
		const cleanJson = rawJson.replace(/```json\n?|\n?```/g, "").trim();

		const parsed = JSON.parse(cleanJson) as Record<string, unknown>;

		const leadDbFiltersResult =
			parsed.leadDbFilters &&
			typeof parsed.leadDbFilters === "object" &&
			!Array.isArray(parsed.leadDbFilters)
				? leadDbFiltersSchema.safeParse(parsed.leadDbFilters)
				: null;

		const result = createSearchTaskBodySchema.parse({
			prompt: input.text,
			chatId: input.chatId,
			source: LeadSource.APOLLO,

			industry:
				typeof parsed.industry === "string" ? parsed.industry : undefined,
			titles: Array.isArray(parsed.titles) ? parsed.titles : [],
			locations: Array.isArray(parsed.locations) ? parsed.locations : [],
			companySize:
				typeof parsed.companySize === "string" ? parsed.companySize : undefined,
			limit: typeof parsed.limit === "number" ? parsed.limit : 100,

			leadDbFilters:
				leadDbFiltersResult?.success === true
					? leadDbFiltersResult.data
					: undefined,
		});

		return result;
	}
}
