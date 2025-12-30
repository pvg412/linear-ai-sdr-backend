import { z } from "zod";

const IdSchema = z.string().min(1);

export const CreateLeadDirectoryBodySchema = z.object({
  name: z.string().min(1).max(200),
  parentId: IdSchema.nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
});

export type CreateLeadDirectoryBody = z.infer<typeof CreateLeadDirectoryBodySchema>;

export const UpdateLeadDirectoryBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    position: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Body must not be empty");

export type UpdateLeadDirectoryBody = z.infer<typeof UpdateLeadDirectoryBodySchema>;

export const MoveLeadDirectoryBodySchema = z.object({
  parentId: IdSchema.nullable(),
});

export type MoveLeadDirectoryBody = z.infer<typeof MoveLeadDirectoryBodySchema>;

export const AddLeadToDirectoryBodySchema = z.object({
  leadId: IdSchema,
});

export type AddLeadToDirectoryBody = z.infer<typeof AddLeadToDirectoryBodySchema>;

export const ListDirectoriesQuerySchema = z.object({
  parentId: IdSchema.optional(),
  tree: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional(),
});

export type ListDirectoriesQuery = z.infer<typeof ListDirectoriesQuerySchema>;

export const ListDirectoryLeadsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = v ? Number(v) : 50;
      return Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 50;
    }),
  offset: z
    .string()
    .optional()
    .transform((v) => {
      const n = v ? Number(v) : 0;
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }),
});

export type ListDirectoryLeadsQuery = z.infer<typeof ListDirectoryLeadsQuerySchema>;
