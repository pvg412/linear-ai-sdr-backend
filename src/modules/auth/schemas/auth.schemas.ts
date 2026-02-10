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
