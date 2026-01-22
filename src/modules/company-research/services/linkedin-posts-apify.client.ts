import { injectable } from "inversify";
import { ApifyClient } from "apify-client";
import { z } from "zod";
import { loadEnv } from "@/config/env";
import { UserFacingError } from "@/infra/userFacingError";

// Input schema for the LinkedIn Posts actor
export interface LinkedinPostsApifyInput {
  targetUrls: string[];
  maxPosts?: number;
  postedLimit?: "1h" | "24h" | "week" | "month" | "3months" | "6months" | "year";
  includeQuotePosts?: boolean;
  includeReposts?: boolean;
  scrapeReactions?: boolean;
  scrapeComments?: boolean;
}

// Schema for author information
const LinkedinPostAuthorSchema = z.object({
  publicIdentifier: z.string().optional().nullable(),
  type: z.enum(["profile", "company"]).optional().nullable(),
  name: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  info: z.string().optional().nullable(),
});

// Schema for engagement metrics
const LinkedinPostEngagementSchema = z.object({
  likes: z.number().optional().nullable(),
  comments: z.number().optional().nullable(),
  shares: z.number().optional().nullable(),
});

// Schema for posted date information
const LinkedinPostPostedAtSchema = z.object({
  timestamp: z.number().optional().nullable(),
  date: z.string().optional().nullable(),
  postedAgoShort: z.string().optional().nullable(),
  postedAgoText: z.string().optional().nullable(),
});

// Main post schema
export const LinkedinPostSchema = z.object({
  type: z.string().optional().nullable(),
  id: z.string(),
  linkedinUrl: z.string(),
  content: z.string().optional().nullable(),
  author: LinkedinPostAuthorSchema.optional().nullable(),
  postedAt: LinkedinPostPostedAtSchema.optional().nullable(),
  engagement: LinkedinPostEngagementSchema.optional().nullable(),
  postImages: z.array(z.unknown()).optional().nullable(),
  document: z
    .object({
      title: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type LinkedinPost = z.infer<typeof LinkedinPostSchema>;

// Transformed result for company research
export interface LinkedinPostResult {
  items: Array<{
    date: string | null;
    summary: string;
    sourceUrl: string;
    category: "linkedin_post";
    engagement?: {
      likes: number;
      comments: number;
      shares: number;
    };
  }>;
}

@injectable()
export class LinkedinPostsApifyClient {
  private client: ApifyClient | null = null;
  private readonly actorId = "harvestapi/linkedin-profile-posts";

  private getClient(): ApifyClient {
    if (!this.client) {
      const env = loadEnv();
      if (!env.APIFY_TOKEN) {
        throw new UserFacingError({
          code: "SERVICE_UNAVAILABLE",
          userMessage: "LinkedIn posts service is not configured",
        });
      }
      this.client = new ApifyClient({ token: env.APIFY_TOKEN });
    }
    return this.client;
  }

  async fetchCompanyPosts(
    companyLinkedinUrl: string,
    options: {
      maxPosts?: number;
      postedLimit?: "24h" | "week" | "month";
    } = {},
  ): Promise<LinkedinPostResult> {
    const client = this.getClient();

    const input: LinkedinPostsApifyInput = {
      targetUrls: [companyLinkedinUrl],
      maxPosts: options.maxPosts ?? 10,
      postedLimit: options.postedLimit ?? "month",
      includeQuotePosts: true,
      includeReposts: false, // Skip reposts - less valuable for research
      scrapeReactions: false, // Don't need detailed reactions
      scrapeComments: false, // Don't need comments
    };

    try {
      // Run the actor and wait for completion
      const run = await client.actor(this.actorId).call(input, {
        waitSecs: 120, // Wait up to 2 minutes
      });

      if (!run.defaultDatasetId) {
        console.warn("LinkedIn posts scraper returned no dataset");
        return { items: [] };
      }

      // Fetch results from the dataset
      const { items } = await client.dataset(run.defaultDatasetId).listItems({
        limit: options.maxPosts ?? 10,
      });

      // Parse and transform results
      const posts: LinkedinPost[] = [];
      for (const item of items) {
        try {
          const parsed = LinkedinPostSchema.parse(item);
          if (parsed.type === "post") {
            // Filter out reactions/comments if any
            posts.push(parsed);
          }
        } catch (e) {
          console.warn("Failed to parse LinkedIn post:", e);
        }
      }

      // Transform to company research format
      return {
        items: posts.map((post) => ({
          date: post.postedAt?.date ?? null,
          summary: this.formatPostSummary(post),
          sourceUrl: post.linkedinUrl,
          category: "linkedin_post" as const,
          engagement: post.engagement
            ? {
                likes: post.engagement.likes ?? 0,
                comments: post.engagement.comments ?? 0,
                shares: post.engagement.shares ?? 0,
              }
            : undefined,
        })),
      };
    } catch (error) {
      if (error instanceof UserFacingError) throw error;

      console.error("LinkedIn Posts Apify error:", error);
      throw new UserFacingError({
        code: "API_ERROR",
        userMessage: "Failed to fetch LinkedIn posts",
        debugMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private formatPostSummary(post: LinkedinPost): string {
    const content = post.content?.trim() ?? "";
    const documentTitle = post.document?.title?.trim();

    // Truncate long content
    const maxLength = 500;
    let summary =
      content.length > maxLength
        ? content.substring(0, maxLength) + "..."
        : content;

    // Add document title if present
    if (documentTitle && !summary.includes(documentTitle)) {
      summary = `[${documentTitle}] ${summary}`;
    }

    // Add engagement metrics as context
    if (post.engagement) {
      const { likes, comments, shares } = post.engagement;
      const engagementParts = [
        likes ? `${this.formatNumber(likes)} likes` : null,
        comments ? `${this.formatNumber(comments)} comments` : null,
        shares ? `${this.formatNumber(shares)} shares` : null,
      ].filter(Boolean);

      if (engagementParts.length > 0) {
        summary += ` (${engagementParts.join(", ")})`;
      }
    }

    return summary || "LinkedIn post (no content)";
  }

  private formatNumber(num: number): string {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k";
    }
    return num.toString();
  }
}
