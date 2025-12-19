import { inject, injectable } from "inversify";
import { z } from "zod";
import { LeadProvider, LeadSearchKind } from "@prisma/client";

import { AiPromptParserService } from "@/modules/ai/ai-prompt-parser.service";
import { AI_TYPES } from "@/modules/ai/ai.types";
import {
	CompanySizeSchema,
	LeadDbCanonicalFiltersSchema,
} from "@/capabilities/lead-db/lead-db.dto";
import { ChatPromptParser } from "./chat.dto";

const LimitSchema = z.number().int().min(1).max(50_000);

const ScraperQuerySchema = z
	.object({
		industry: z.string().trim().min(1).optional(),
		titles: z.array(z.string().trim().min(1)).default([]),
		locations: z.array(z.string().trim().min(1)).default([]),
		companySize: CompanySizeSchema.optional(),
		companyKeywords: z.array(z.string().trim().min(1)).optional(),
	})
	.strip();

// type ScraperQuery = z.infer<typeof ScraperQuerySchema>;

const AiLeadDbOutputSchema = z
	.object({
		limit: LimitSchema.optional(),
		query: LeadDbCanonicalFiltersSchema.default({}),
	})
	.strip();

const AiScraperOutputSchema = z
	.object({
		limit: LimitSchema.optional(),
		query: ScraperQuerySchema.default({ titles: [], locations: [] }),
	})
	.strip();

@injectable()
export class ChatAiPromptParser implements ChatPromptParser {
	constructor(
		@inject(AI_TYPES.AiPromptParserService)
		private readonly aiPromptParserService: AiPromptParserService
	) {}

	async parsePrompt(input: {
		text: string;
		provider: LeadProvider;
		kind: LeadSearchKind;
	}): Promise<{ query: Record<string, unknown>; suggestedLimit?: number }> {
		const { provider, kind, text } = input;

		if (kind === LeadSearchKind.LEAD_DB) {
			const systemPrompt = buildLeadDbSystemPrompt(provider);

			const out = await this.aiPromptParserService.completeJson({
				systemPrompt,
				userPrompt: text,
				schema: AiLeadDbOutputSchema,
			});

			// query is LeadDbCanonicalFilters
			return {
				query: out.query,
				suggestedLimit: out.limit,
			};
		}

		if (kind === LeadSearchKind.SCRAPER) {
			const systemPrompt = buildScraperSystemPrompt(provider);

			const out = await this.aiPromptParserService.completeJson({
				systemPrompt,
				userPrompt: text,
				schema: AiScraperOutputSchema,
			});

			// query is ScraperQuery
			return {
				query: out.query,
				suggestedLimit: out.limit,
			};
		}

		// Should never happen due to Prisma enum, but keep it safe.
		throw new Error(`Unsupported LeadSearchKind: ${String(kind)}`);
	}
}

function buildLeadDbSystemPrompt(provider: LeadProvider): string {
	return `
You convert user requests into canonical Lead DB filters for the selected provider.

Selected provider: ${provider}

Return ONLY valid JSON in this exact shape:
{
  "limit": 100,
  "query": {
    "seniorityLevel"?: string,
    "functionDept"?: string,

    "personTitles"?: string[],
    "personCountry"?: string,
    "personState"?: string,
    "personCities"?: string[],

    "companyIndustry"?: string,
    "companySize"?: "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1000+",

    "companyCountry"?: string,
    "companyState"?: string,
    "companyCities"?: string[],

    "companyDomains"?: string[],
    "companyKeywords"?: string[],

    "hasPhone"?: boolean
  }
}

Rules:
- JSON only. No markdown. No code fences.
- If user specifies a number of leads, set "limit" to it, otherwise 100.
- Locations must be in English.
- Use personTitles for job titles (include reasonable variants like CTO / Chief Technology Officer).
- Put "web3/crypto/blockchain/AI" and similar into companyKeywords if mentioned.
- Omit unknown keys. Do not invent fields not listed above.
`.trim();
}

function buildScraperSystemPrompt(provider: LeadProvider): string {
	return `
You convert user requests into a generic scraping query for the selected provider.

Selected provider: ${provider}

Return ONLY valid JSON in this exact shape:
{
  "limit": 100,
  "query": {
    "industry"?: string,
    "titles": string[],
    "locations": string[],
    "companySize"?: "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1000+",
    "companyKeywords"?: string[]
  }
}

Rules:
- JSON only. No markdown. No code fences.
- If user specifies a number of leads, set "limit" to it, otherwise 100.
- titles and locations must be arrays (can be empty).
- Locations must be in English.
- Keep it minimal and omit unknown keys.
`.trim();
}
