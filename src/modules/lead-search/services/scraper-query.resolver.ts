import { LeadProvider, Prisma } from "@prisma/client";
import {
	getScrapeQuerySchemaForProvider,
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
	provider: LeadProvider;
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
		provider: input.provider,
	});

	if (didAddApolloUrl) {
		// Persist canonical query to avoid future job failures on retries.
		await input.leadSearchRepository.updateQuery(
			input.leadSearchId,
			canonicalQuery as Prisma.InputJsonValue
		);
	}

	const schema = getScrapeQuerySchemaForProvider(input.provider);

	if (!schema) {
		return {
			ok: false,
			issues: [{ path: "provider", message: "Invalid provider" }],
		};
	}

	const parsed = schema.safeParse({
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
