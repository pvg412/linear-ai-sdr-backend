import { z } from "zod";

export const ScraperCityStartResponseSchema = z.object({
	runId: z.string().min(1),
});

export const ScraperCityStatusResponseSchema = z.object({
	status: z.string().min(1),
	statusMessage: z.string().optional().nullable(),
	handled: z.number().optional().nullable(),
	runTimeSecs: z.number().optional().nullable(),
	outputUrl: z.string().optional().nullable(),
});

export type ScraperCityStatusResponse = z.infer<
	typeof ScraperCityStatusResponseSchema
>;

/**
 * ScraperCity downloads can come in camelCase (download JSON),
 * while some other endpoints / historic versions can be snake_case.
 *
 * We accept BOTH + passthrough so we don't lose unknown provider fields
 * (important for debugging & raw storage).
 */
export const ScraperCityApolloRowSchema = z.looseObject({
	id: z.string().optional().nullable(),

	// person name fields
	fullName: z.string().optional().nullable(),
	full_name: z.string().optional().nullable(),
	name: z.string().optional().nullable(),

	firstName: z.string().optional().nullable(),
	first_name: z.string().optional().nullable(),

	lastName: z.string().optional().nullable(),
	last_name: z.string().optional().nullable(),

	// role/title
	position: z.string().optional().nullable(), // download JSON uses this
	title: z.string().optional().nullable(), // other schemas can use this

	// linkedin
	linkedinUrl: z.string().optional().nullable(),
	linkedin_url: z.string().optional().nullable(),

	// location (download JSON часто еще дает city/country/state отдельно)
	location: z.string().optional().nullable(),
	city: z.string().optional().nullable(),
	state: z.string().optional().nullable(),
	country: z.string().optional().nullable(),

	// email fields
	workEmail: z.string().optional().nullable(),
	work_email: z.string().optional().nullable(),
	email: z.string().optional().nullable(),

	// company fields (download JSON uses org*)
	orgName: z.string().optional().nullable(),
	company_name: z.string().optional().nullable(),

	orgWebsite: z.string().optional().nullable(),
	company_website: z.string().optional().nullable(),

	orgDomain: z.string().optional().nullable(),
	company_domain: z.string().optional().nullable(),
});

export type ScraperCityApolloRow = z.infer<typeof ScraperCityApolloRowSchema>;
