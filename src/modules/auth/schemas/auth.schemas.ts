import { z } from "zod";

export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const devRegisterBodySchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export type DevRegisterBody = z.infer<typeof devRegisterBodySchema>;

export const createSaleManagerBodySchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export type CreateSaleManagerBody = z.infer<typeof createSaleManagerBodySchema>;

export const createCompanyBodySchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  companyName: z.string().min(1).max(255),
});

export type CreateCompanyBody = z.infer<typeof createCompanyBodySchema>;

export const listSaleManagersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListSaleManagersQuery = z.infer<typeof listSaleManagersQuerySchema>;

export const saleManagerIdParamsSchema = z.object({
  saleManagerId: z.string().min(1),
});

export type SaleManagerIdParams = z.infer<typeof saleManagerIdParamsSchema>;

export const updateCompanyNameBodySchema = z.object({
  companyName: z.string().min(1).max(255),
});

export type UpdateCompanyNameBody = z.infer<typeof updateCompanyNameBodySchema>;

/**
 * Regex patterns to detect code / structured data in custom instructions.
 * Rejects JSON objects/arrays, HTML tags, code blocks, import/require statements,
 * and other programming constructs that could be used for prompt injection.
 */
const DISALLOWED_PATTERNS = [
  /[{}[\]]/,                       // JSON-like braces/brackets
  /<\/?[a-z][a-z0-9]*[\s>]/i,      // HTML/XML tags
  /```/,                           // Markdown code blocks
  /\b(import|require|export|function|const|let|var|class|def|return)\b/i, // Programming keywords
  /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\b/i, // SQL keywords
] as const;

export const updateCustomInstructionsBodySchema = z.object({
  customInstructions: z
    .string()
    .max(500, "Custom instructions must be 500 characters or fewer")
    .refine(
      (val) => !DISALLOWED_PATTERNS.some((pattern) => pattern.test(val)),
      {
        message:
          "Custom instructions must be plain text only. Code, JSON, HTML, and programming constructs are not allowed.",
      },
    )
    .nullable(),
});

export type UpdateCustomInstructionsBody = z.infer<typeof updateCustomInstructionsBodySchema>;
