import { z } from "zod";

export const LeadPaginationFiltersSchema = z.object({
	leadSearchId: z.cuid().optional(),
	createdById: z.cuid().optional(),
	email: z.email().optional(),
});

export type LeadPaginationFilters = z.infer<typeof LeadPaginationFiltersSchema>;

export const LeadPaginationSchema = z
	.object({
		page: z.coerce.number().int().min(1).optional(),
		perPage: z.coerce.number().int().min(1).max(200).optional(),

		filters: LeadPaginationFiltersSchema.optional(),
	})
	.refine(
		(v) =>
			(v.page === undefined && v.perPage === undefined) ||
			(v.page !== undefined && v.perPage !== undefined),
		{
			message: "Both page and perPage are required together",
			path: ["page"],
		}
	);

export type LeadPaginationQuery = z.infer<typeof LeadPaginationSchema>;
