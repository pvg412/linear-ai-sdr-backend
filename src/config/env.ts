import { z } from "zod";

const EnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().default(3001),
	DATABASE_URL: z.url(),

	TELEGRAM_BOT_ACCESS_TOKEN: z.string(),
	TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),

	OPENAI_API_KEY: z.string(),
	OPENAI_MODEL: z.string(),

	SCRAPERCITY_API_KEY: z.string(),
  SCRAPERCITY_API_URL: z.url(),

	SEARCH_LEADS_API_KEY: z.string(),
	SEARCH_LEADS_API_URL: z.url(),

	SCRUPP_SCRAPER_API_KEY: z.string(),
	SCRUPP_SCRAPER_API_URL: z.url(),
	SCRUPP_ACCOUNT_EMAIL: z.string().optional(),
  SCRUPP_ACCOUNT_TYPE: z.enum(["linkedin", "apollo"]).optional(),
  SCRUPP_ACCOUNT_COOKIE: z.string().optional(),
  SCRUPP_ACCOUNT_AGENT: z.string().optional(),
  SCRUPP_ACCOUNT_PREMIUM: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

export const loadEnv = (): Env => {
	const parsed = EnvSchema.safeParse(process.env);
	if (!parsed.success) {
		console.error(z.treeifyError(parsed.error));
		throw new Error("Invalid environment variables");
	}
	return parsed.data;
};
