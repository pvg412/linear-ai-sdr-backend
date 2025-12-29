import { Prisma } from "@prisma/client";
import {
	ScrapeQuerySchema,
	type ScrapeQuery,
} from "@/capabilities/scraper/scraper.dto";
import { canonicalizeScraperStoredQuery } from "@/modules/lead-search/scraperQueryCanonicalizer";
import type { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";

type Issue = { path: string; message: string };

export type ResolveScrapeQueryResult =
	| { ok: true; scrapeQuery: ScrapeQuery }
	| { ok: false; issues: Issue[] };

export async function resolveScrapeQuery(input: {
	leadSearchId: string;
	leadSearchLimit: number;
	storedQueryJson: unknown;
	leadSearchRepository: LeadSearchRepository;
}): Promise<ResolveScrapeQueryResult> {
	const queryObj =
		input.storedQueryJson &&
		typeof input.storedQueryJson === "object" &&
		!Array.isArray(input.storedQueryJson)
			? (input.storedQueryJson as Record<string, unknown>)
			: {};

	const { canonicalQuery, didAddApolloUrl } = canonicalizeScraperStoredQuery({
		storedQuery: queryObj,
		limit: input.leadSearchLimit,
		leadSearchId: input.leadSearchId,
	});

	if (didAddApolloUrl) {
		// Persist canonical query to avoid future job failures on retries.
		await input.leadSearchRepository.updateQuery(
			input.leadSearchId,
			canonicalQuery as Prisma.InputJsonValue
		);
	}

	const parsed = ScrapeQuerySchema.safeParse({
		...canonicalQuery,
		limit: input.leadSearchLimit,
	});

	if (!parsed.success) {
		const issues: Issue[] = parsed.error.issues.map((i) => ({
			path: i.path.join("."),
			message: i.message,
		}));
		return { ok: false, issues };
	}

	return { ok: true, scrapeQuery: parsed.data };
}
