import { injectable } from "inversify";
import { Perplexity } from "@perplexity-ai/perplexity_ai";
import { loadEnv } from "@/config/env";
import { UserFacingError } from "@/infra/userFacingError";
import { ensureLogger } from "@/infra/observability";
import { validateSearchResults } from "../utils/url-validator";

const PERPLEXITY_TIMEOUT_MS = 30000; // 30 seconds
const PERPLEXITY_MAX_RETRIES = 3;
const PERPLEXITY_RETRY_BACKOFF_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;
    backoffMs: number;
    onRetry?: (attempt: number, error: Error) => void;
  },
): Promise<T> {
  let lastError: Error = new Error("No attempts made");
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < options.maxAttempts) {
        options.onRetry?.(attempt, lastError);
        await sleep(options.backoffMs * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export interface PerplexitySearchOptions {
  companyName: string;
  companyDomain?: string | null;
  companyWebsites?: string[];
  recency?: "day" | "week" | "month" | "year";
  maxResults?: number;
}

export interface PerplexitySearchResult {
  items: Array<{
    date: string | null;
    summary: string;
    sourceUrl: string;
    category: "news" | "blog" | "activity" | "website";
  }>;
  citations: string[];
}

@injectable()
export class PerplexityClient {
  private client: Perplexity | null = null;

  private getClient(): Perplexity {
    if (!this.client) {
      const env = loadEnv();
      if (!env.PERPLEXITY_API_KEY) {
        throw new UserFacingError({
          code: "SERVICE_UNAVAILABLE",
          userMessage: "Perplexity AI service is not configured",
        });
      }
      this.client = new Perplexity({ apiKey: env.PERPLEXITY_API_KEY });
    }
    return this.client;
  }

  async searchCompanyInfo(
    options: PerplexitySearchOptions,
  ): Promise<PerplexitySearchResult> {
    const client = this.getClient();

    // Build domain filter - prioritize company domains
    // Perplexity expects bare domain names (e.g. "oumla.com"), not full URLs.
    const domainFilter: string[] = [];
    if (options.companyDomain) {
      const cleaned = extractDomain(options.companyDomain);
      if (cleaned) domainFilter.push(cleaned);
    }
    if (options.companyWebsites?.length) {
      for (const url of options.companyWebsites) {
        const domain = extractDomain(url);
        if (domain && !domainFilter.includes(domain)) {
          domainFilter.push(domain);
        }
      }
    }

    // Build the prompt requesting structured JSON output
    const systemPrompt = `You are a sales intelligence research assistant helping SDRs and sales managers gather actionable insights about companies.

Your task is to find BUSINESS-CRITICAL information that helps with sales outreach and qualification. Focus on:
- Revenue, funding rounds, and financial performance
- Growth indicators (hiring, expansion, new offices)
- Product launches and new initiatives
- Strategic partnerships and acquisitions
- Pain points, challenges, or transformation initiatives
- Technology stack changes or digital transformation efforts
- Leadership changes (new executives, key hires)
- Awards, recognition, industry rankings

Return a JSON object with this exact structure:
{
  "items": [
    {
      "date": "YYYY-MM-DD or null if unknown",
      "summary": "A concise 1-2 sentence summary highlighting the SALES RELEVANCE",
      "sourceUrl": "The URL where this information was found",
      "category": "news|blog|activity|website"
    }
  ]
}

CRITICAL: For the "date" field:
- Extract the PUBLICATION DATE or ARTICLE DATE from the content (e.g., "Published on Oct 9, 2025")
- Do NOT use today's date or the date you're searching
- If you cannot find the actual publication date in the article, set it to null
- Look for dates in article metadata, headers, or "Published:" labels

Categories:
- "news": Funding rounds, revenue reports, acquisitions, leadership changes, awards
- "blog": Product launches, new features, thought leadership on challenges
- "activity": Partnerships, expansion, hiring sprees, office openings, events
- "website": Company overview, tech stack, products/services, customer base

Requirements:
- Return only valid JSON, no markdown or explanation
- Prioritize recent information that indicates buying signals or timing opportunities
- Each summary must be sales-relevant (helps with outreach timing or personalization)
- Limit summaries to 2 sentences maximum
- Always include sourceUrl for each item — use the EXACT full URL from the source page, do NOT shorten, modify, or reconstruct URLs
- Return up to ${options.maxResults || 5} items total`;

    const userPrompt = `Research "${options.companyName}" for sales intelligence. Find:
1. Revenue, funding, or financial performance updates
2. Growth signals (hiring, expansion, new products)
3. Strategic initiatives, partnerships, or technology investments
4. Pain points, challenges, or transformation efforts
5. Leadership changes or key company milestones
${options.companyDomain ? `Company website: ${options.companyDomain}` : ""}

Focus on actionable insights for sales outreach.

IMPORTANT: For each item, extract the ACTUAL PUBLICATION DATE from the article (e.g., "Published: October 9, 2025"), NOT today's date.`;

    const lg = ensureLogger();

    try {
      const response = await withRetry(
        () =>
          withTimeout(
            client.chat.completions.create({
              model: "sonar-pro",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              search_domain_filter:
                domainFilter.length > 0 ? domainFilter : undefined,
              search_recency_filter: options.recency,
              return_related_questions: false,
              web_search_options: {
                search_context_size: "high",
              },
              temperature: 0.1, // Low temperature for more factual responses
            }),
            PERPLEXITY_TIMEOUT_MS,
            `Perplexity API timeout after ${PERPLEXITY_TIMEOUT_MS}ms`,
          ),
        {
          maxAttempts: PERPLEXITY_MAX_RETRIES,
          backoffMs: PERPLEXITY_RETRY_BACKOFF_MS,
          onRetry: (attempt, error) => {
            lg.warn(
              {
                attempt,
                maxAttempts: PERPLEXITY_MAX_RETRIES,
                err: error,
                companyName: options.companyName,
              },
              "Perplexity API call failed, retrying",
            );
          },
        },
      );

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new UserFacingError({
          code: "API_ERROR",
          userMessage: "No response received from Perplexity AI",
        });
      }

      // Extract text content if it's an array
      let textContent = Array.isArray(content)
        ? content
          .filter((chunk) => "text" in chunk)
          .map((chunk) => ("text" in chunk ? chunk.text : ""))
          .join("")
        : content;

      // Remove markdown code block formatting if present
      // Also handle case where there's text after the closing ```
      textContent = textContent
        .replace(/^```json\s*/i, "")
        .replace(/\s*```[\s\S]*$/, "") // Remove ``` and everything after it
        .trim();

      // Parse JSON response
      let parsed: { items: PerplexitySearchResult["items"] };
      try {
        const jsonResult: unknown = JSON.parse(textContent);
        // Type guard to ensure the parsed result has the expected structure
        if (
          typeof jsonResult === "object" &&
          jsonResult !== null &&
          "items" in jsonResult &&
          Array.isArray(jsonResult.items)
        ) {
          parsed = jsonResult as { items: PerplexitySearchResult["items"] };
        } else {
          lg.warn(
            { response: jsonResult, companyName: options.companyName },
            "Invalid Perplexity response structure",
          );
          return { items: [], citations: [] };
        }
      } catch {
        // If JSON parsing fails, return empty results
        lg.warn(
          { response: content, companyName: options.companyName },
          "Failed to parse Perplexity JSON response",
        );
        return { items: [], citations: [] };
      }

      // Extract citations from response
      // Perplexity SDK doesn't export types for these fields, so we need to cast
      type PerplexityResponse = {
        citations?: string[];
      };

      const extendedResponse = response as unknown as PerplexityResponse;
      const citations = extendedResponse.citations || [];
      const rawItems = parsed.items || [];

      // Validate sourceUrls: match against real citations, then HEAD-check the rest
      const { items: validatedItems, stats } = await validateSearchResults(
        rawItems,
        citations,
        lg,
      );

      lg.info(
        {
          companyName: options.companyName,
          totalItems: stats.totalItems,
          citationMatched: stats.citationMatched,
          headCheckPassed: stats.headCheckPassed,
          removed: stats.removed,
        },
        "Perplexity URL validation completed",
      );

      return {
        items: validatedItems as PerplexitySearchResult["items"],
        citations,
      };
    } catch (error) {
      if (error instanceof UserFacingError) throw error;

      lg.error(
        { err: error, companyName: options.companyName },
        "Perplexity API error after all retries",
      );
      throw new UserFacingError({
        code: "API_ERROR",
        userMessage: "Failed to search company information",
        debugMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Extracts a bare, lowercased domain from a value that may be a full URL
 * (e.g. "https://Oumla.com/about") or already a plain domain ("oumla.com").
 *
 * Returns null if the input cannot be parsed into a valid domain.
 */
function extractDomain(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // If it looks like a URL (has protocol or starts with //), parse with URL
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  // Otherwise treat as a bare domain — strip any path/query/port
  const bare = trimmed
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();

  // Basic validation: must have at least one dot and no spaces
  if (!bare.includes(".") || /\s/.test(bare)) return null;

  return bare;
}
