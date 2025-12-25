import { z } from "zod";

export const LeadPaginationSchema = z
	.object({
		leadSearchId: z.cuid().optional(),

		page: z.coerce.number().int().min(1).optional(),
		perPage: z.coerce.number().int().min(1).max(200).optional(),
	})
	.refine(
		(v) =>
			(v.page === undefined && v.perPage === undefined) ||
			(v.page !== undefined && v.perPage !== undefined),
		{
			message: "Both page and perPage are required together",
			path: ["page"],
		}
	)
