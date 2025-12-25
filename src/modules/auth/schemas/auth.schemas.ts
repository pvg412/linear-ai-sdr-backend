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

