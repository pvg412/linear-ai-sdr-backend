import { z } from "zod";

const optionalTrimmedString = z
	.string()
	.optional()
	.transform((v) => {
		if (typeof v !== "string") return undefined;
		const trimmed = v.trim();
		return trimmed ? trimmed : undefined;
	});

const EnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().default(3001),
	DATABASE_URL: z.url(),

	AUTH_JWT_SECRET: z
		.string()
		.min(16)
		.default("dev-insecure-secret-change-me-please-123456"),
	AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 12),
	AUTH_ALLOW_DEV_REGISTER: z
		.string()
		.optional()
		.transform((v) => v === "true"),

	AUTH_INITIAL_ADMIN_EMAIL: z.email().optional(),
	AUTH_INITIAL_ADMIN_PASSWORD: z.string().min(8).optional(),

	OPENAI_API_KEY: optionalTrimmedString,
	OPENAI_MODEL: optionalTrimmedString,

	SCRAPERCITY_API_KEY: z.string().optional(),
	SCRAPERCITY_API_URL: z.url().optional(),

	SEARCH_LEADS_API_KEY: z.string().optional(),
	SEARCH_LEADS_API_URL: z.url().optional(),

	SCRUPP_SCRAPER_API_KEY: z.string().optional(),
	SCRUPP_SCRAPER_API_URL: z.url().optional(),
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

	const hasOpenAiKey = typeof parsed.data.OPENAI_API_KEY === "string";
	const hasOpenAiModel = typeof parsed.data.OPENAI_MODEL === "string";
	if (hasOpenAiKey !== hasOpenAiModel) {
		throw new Error("OPENAI_API_KEY and OPENAI_MODEL must be set together");
	}

	if (
		parsed.data.NODE_ENV === "production" &&
		typeof process.env.AUTH_JWT_SECRET !== "string"
	) {
		throw new Error("AUTH_JWT_SECRET must be set in production");
	}

	return parsed.data;
};
