import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().optional(),
  FRONTEND_URL: z.url(),

  MINIO_ENDPOINT: z.string().optional(),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_REGION: z.string().optional(),
  MINIO_BUCKET_LEAD_SEARCH_RAW: z.string().optional(),

  AI_GRPC_ADDRESS: z.string().optional(),
  AI_GRPC_INSECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  LEAD_SEARCH_QUEUE_CONCURRENCY: z.coerce.number().default(4),
  LEAD_SEARCH_QUEUE_ATTEMPTS: z.coerce.number().default(3),
  LEAD_SEARCH_QUEUE_BACKOFF_MS: z.coerce.number().default(5000),

  LEAD_RAG_INDEX_QUEUE_CONCURRENCY: z.coerce.number().default(4),
  LEAD_RAG_INDEX_QUEUE_ATTEMPTS: z.coerce.number().default(3),
  LEAD_RAG_INDEX_QUEUE_BACKOFF_MS: z.coerce.number().default(5000),

  AUTH_JWT_SECRET: z
    .string()
    .min(16)
    .default("dev-insecure-secret-change-me-please-123456"),
  AUTH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 12),
  AUTH_ALLOW_DEV_REGISTER: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  AUTH_INITIAL_ADMIN_EMAIL: z.email().optional(),
  AUTH_INITIAL_ADMIN_PASSWORD: z.string().min(8).optional(),

  APIFY_TOKEN: z.string().optional(),
  APIFY_MONGODB_CONNECTION_STRING: z.string().optional(),

  SCRAPERCITY_API_KEY: z.string().optional(),
  SCRAPERCITY_API_URL: z.url().optional(),

  SEARCH_LEADS_API_KEY: z.string().optional(),
  SEARCH_LEADS_API_URL: z.url().optional(),

  PERPLEXITY_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export const loadEnv = (): Env => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(z.treeifyError(parsed.error));
    throw new Error("Invalid environment variables");
  }

  if (
    parsed.data.NODE_ENV === "production" &&
    typeof process.env.AUTH_JWT_SECRET !== "string"
  ) {
    throw new Error("AUTH_JWT_SECRET must be set in production");
  }

  return parsed.data;
};
