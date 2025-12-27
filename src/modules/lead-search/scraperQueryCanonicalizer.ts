import { z } from "zod";

import { buildApolloPeopleUrl } from "@/capabilities/scraper/apolloUrlBuilder";
import { CompanySizeSchema } from "@/capabilities/lead-db/lead-db.dto";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

const ScraperFiltersSchema = z
	.object({
		industry: z.string().trim().min(1).optional(),
		titles: z.array(z.string().trim().min(1)).optional(),
		locations: z.array(z.string().trim().min(1)).optional(),
		companySize: CompanySizeSchema.optional(),
		companyKeywords: z.array(z.string().trim().min(1)).optional(),
	})
	.strip();

export function canonicalizeScraperStoredQuery(input: {
	storedQuery: unknown;
	limit: number;
	leadSearchId?: string;
}): { canonicalQuery: UnknownRecord; didAddApolloUrl: boolean } {
	const base: UnknownRecord = isRecord(input.storedQuery) ? input.storedQuery : {};

	const apolloUrlRaw = base.apolloUrl;
	if (typeof apolloUrlRaw === "string" && apolloUrlRaw.trim().length > 0) {
		return { canonicalQuery: base, didAddApolloUrl: false };
	}

	// Best-effort: if stored query contains filters, build an Apollo URL.
	// This keeps backwards compatibility with older persisted query shape.
	const parsedFilters = ScraperFiltersSchema.safeParse(base);
	if (!parsedFilters.success) {
		return { canonicalQuery: base, didAddApolloUrl: false };
	}

	const { apolloUrl } = buildApolloPeopleUrl({
		...parsedFilters.data,
		limit: input.limit,
		id: input.leadSearchId,
	});

	return {
		canonicalQuery: { ...base, apolloUrl },
		didAddApolloUrl: true,
	};
}


