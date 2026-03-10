import { z } from "zod";
import { SignalCategory } from "@prisma/client";

// ── Param schemas ─────────────────────────────────────────────────────

export const serviceCatalogIdParamSchema = z.object({
  serviceCatalogId: z.string().min(1, "serviceCatalogId is required"),
});

// ── Field schemas ─────────────────────────────────────────────────────

const SignalCategoryEnumSchema = z.enum(SignalCategory);

const SignalDescriptionSchema = z
  .string()
  .trim()
  .min(10, "Description must be at least 10 characters")
  .max(500, "Description must be at most 500 characters");

// ── Upsert body (PUT /company/service-catalog/:id/signal-categories) ──

const SignalCategoryItemSchema = z.object({
  category: SignalCategoryEnumSchema,
  description: SignalDescriptionSchema,
  enabled: z.boolean().default(true),
});

export const upsertSignalCategoriesBodySchema = z
  .object({
    categories: z
      .array(SignalCategoryItemSchema)
      .min(1, "At least one category must be provided")
      .max(Object.keys(SignalCategory).length, "Too many categories")
      .refine(
        (items) => {
          const cats = items.map((i) => i.category);
          return new Set(cats).size === cats.length;
        },
        { message: "Duplicate categories are not allowed" },
      ),
  });

export type UpsertSignalCategoriesBody = z.infer<typeof upsertSignalCategoriesBodySchema>;
export type SignalCategoryItem = z.infer<typeof SignalCategoryItemSchema>;
