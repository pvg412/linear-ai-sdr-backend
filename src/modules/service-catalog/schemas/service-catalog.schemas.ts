import { z } from "zod";

// ── Shared field schemas ──────────────────────────────────────────────

const ServiceNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name must be at most 120 characters");

const PrioritySchema = z
  .number()
  .int("Priority must be an integer")
  .min(1, "Priority must be between 1 and 10")
  .max(10, "Priority must be between 1 and 10");

const BudgetSchema = z
  .number()
  .int("Budget must be an integer")
  .min(0, "Budget must be >= 0");

const CuidParamSchema = z.string().min(1);

// ── Service schemas ───────────────────────────────────────────────────

export const createServiceBodySchema = z.object({
  name: ServiceNameSchema,
});
export type CreateServiceBody = z.infer<typeof createServiceBodySchema>;

export const updateServiceBodySchema = z
  .object({
    name: ServiceNameSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Body must not be empty");
export type UpdateServiceBody = z.infer<typeof updateServiceBodySchema>;

export const serviceCatalogIdParamsSchema = z.object({
  serviceCatalogId: CuidParamSchema,
});
export type ServiceCatalogIdParams = z.infer<typeof serviceCatalogIdParamsSchema>;

// ── Sub-service schemas ───────────────────────────────────────────────

export const createSubServiceBodySchema = z
  .object({
    name: ServiceNameSchema,
    priority: PrioritySchema,
    budgetMin: BudgetSchema,
    budgetMax: BudgetSchema,
  })
  .refine((v) => v.budgetMin <= v.budgetMax, {
    message: "budgetMin must be less than or equal to budgetMax",
    path: ["budgetMin"],
  });
export type CreateSubServiceBody = z.infer<typeof createSubServiceBodySchema>;

export const updateSubServiceBodySchema = z
  .object({
    name: ServiceNameSchema.optional(),
    priority: PrioritySchema.optional(),
    budgetMin: BudgetSchema.optional(),
    budgetMax: BudgetSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Body must not be empty")
  .refine(
    (v) => {
      if (v.budgetMin !== undefined && v.budgetMax !== undefined) {
        return v.budgetMin <= v.budgetMax;
      }
      return true;
    },
    {
      message: "budgetMin must be less than or equal to budgetMax",
      path: ["budgetMin"],
    },
  );
export type UpdateSubServiceBody = z.infer<typeof updateSubServiceBodySchema>;

export const subServiceIdParamsSchema = z.object({
  subServiceId: CuidParamSchema,
});
export type SubServiceIdParams = z.infer<typeof subServiceIdParamsSchema>;
