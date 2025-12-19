import z from "zod";
import { LeadProvider } from "@prisma/client";
import { NormalizedLead } from "../shared/leadValidate";

export const CompanySizeSchema = z.enum([
	"1-10",
	"11-50",
	"51-200",
	"201-500",
	"501-1000",
	"1000+",
]);

export const LeadDbCanonicalFiltersSchema = z
	.object({
		seniorityLevel: z.string().optional(),
		functionDept: z.string().optional(),

		personTitles: z.array(z.string()).optional(),
		personCountry: z.string().optional(),
		personState: z.string().optional(),
		personCities: z.array(z.string()).optional(),

		companyIndustry: z.string().optional(),
		companySize: CompanySizeSchema.optional(),
		companyCountry: z.string().optional(),
		companyState: z.string().optional(),
		companyCities: z.array(z.string()).optional(),

		companyDomains: z.array(z.string()).optional(),
		companyKeywords: z.array(z.string()).optional(),

		hasPhone: z.boolean().optional(),
	}) //strips unknown keys instead of failing (matches "omit unknown keys").
	.strip();

export type LeadDbCanonicalFilters = z.infer<
	typeof LeadDbCanonicalFiltersSchema
>;

export interface LeadDbQuery {
	limit: number;
	fileName?: string;

	/**
	 * Preferred (new): canonical filters.
	 */
	filters?: LeadDbCanonicalFilters;

	/**
	 * Backward-compatible (old): "Apollo-like" object, still supported.
	 */
	apolloFilters?: Record<string, unknown>;

	/**
	 * Rare: manual provider-specific payload override.
	 * Example: providerOverrides[LeadProvider.SEARCH_LEADS] = { ...SearchLeadsFilter }
	 */
	providerOverrides?: Partial<Record<LeadProvider, unknown>>;
}


export interface LeadDbAdapterResult {
	provider: LeadProvider;
	providerRunId?: string | null;
	fileNameHint?: string | null;
	leads: NormalizedLead[];
}

export interface LeadDbAdapter {
	provider: LeadProvider;
	isEnabled(): boolean;
	scrape(query: LeadDbQuery): Promise<LeadDbAdapterResult>;
}

export interface LeadDbOrchestratorOptions {
  /**
   * Ordered list of providers to try.
   * In your UI flow it will be 1 provider, but we keep list for fallback strategy.
   */
  providersOrder: LeadProvider[];

  /**
   * If true -> stop after first successful provider.
   * UI-selected provider => should be true.
   * If you want multi-provider merge sequentially => set false.
   */
  stopOnFirstSuccess?: boolean;
}

export interface LeadDbOrchestratorResult {
	providerResults: LeadDbAdapterResult[];
	errors: Partial<Record<LeadProvider, string>>;
}
