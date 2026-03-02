import { z } from "zod";

/**
 * Zod schemas for the `harshmaur/reddit-scraper-pro` Apify actor response.
 *
 * Schemas are intentionally lenient (`.optional().nullable()`) to handle
 * inconsistent data from the scraper. Only `id` is required for dedup.
 */

export const RedditScrapedPostSchema = z.object({
  id: z.string(),
  title: z.string().optional().nullable(),
  body: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  username: z.string().optional().nullable(),
  subreddit: z.string().optional().nullable(),
  communityName: z.string().optional().nullable(),
  score: z.number().optional().nullable(),
  numberOfComments: z.number().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  dataType: z.string().optional().nullable(), // "post" | "comment"
  parsedCreatedAt: z.string().optional().nullable(),
});

export type RedditScrapedPost = z.infer<typeof RedditScrapedPostSchema>;
