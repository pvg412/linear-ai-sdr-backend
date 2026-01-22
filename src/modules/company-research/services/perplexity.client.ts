import { injectable } from "inversify";
import { Perplexity } from "@perplexity-ai/perplexity_ai";
import { loadEnv } from "@/config/env";
import { UserFacingError } from "@/infra/userFacingError";

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
    const domainFilter: string[] = [];
    if (options.companyDomain) {
      domainFilter.push(options.companyDomain);
    }
    if (options.companyWebsites?.length) {
      for (const url of options.companyWebsites) {
        try {
          const domain = new URL(url).hostname;
          if (!domainFilter.includes(domain)) {
            domainFilter.push(domain);
          }
        } catch {
          /* ignore invalid URLs */
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
- Always include sourceUrl for each item
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

    try {
      const response = await client.chat.completions.create({
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
      });

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
      textContent = textContent
        .replace(/^```json\s*/i, "")
        .replace(/\s*```$/, "")
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
          console.error("Invalid response structure:", jsonResult);
          return { items: [], citations: [] };
        }
      } catch {
        // If JSON parsing fails, return empty results
        console.error("Failed to parse Perplexity response:", content);
        return { items: [], citations: [] };
      }

      // Extract citations from response
      // Perplexity SDK doesn't export types for these fields, so we need to cast
      type PerplexityResponse = {
        citations?: string[];
      };

      const extendedResponse = response as unknown as PerplexityResponse;

      return {
        items: parsed.items || [],
        citations: extendedResponse.citations || [],
      };
    } catch (error) {
      if (error instanceof UserFacingError) throw error;

      console.error("Perplexity API error:", error);
      throw new UserFacingError({
        code: "API_ERROR",
        userMessage: "Failed to search company information",
        debugMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
