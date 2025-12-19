import { injectable, multiInject } from "inversify";
import { LeadProvider } from "@prisma/client";

import type {
	ScrapeQuery,
	ScraperAdapter,
	ScraperAdapterResult,
	ScraperAttempt,
	ScraperOrchestratorHooks,
	ScraperOrchestratorOptions,
	ScraperOrchestratorResult,
} from "./scraper.dto";
import { SCRAPER_TYPES } from "./scraper.types";
import { nowNs, msSince, type LoggerLike } from "@/infra/observability";

@injectable()
export class ScraperOrchestrator {
	constructor(
		@multiInject(SCRAPER_TYPES.ScraperAdapter)
		private readonly adapters: ScraperAdapter[]
	) {}

	private getAdapter(provider: LeadProvider): ScraperAdapter | undefined {
		return this.adapters.find((a) => a.provider === provider);
	}

	async scrapeWithFallback<Ctx = void>(
		query: ScrapeQuery,
		options: ScraperOrchestratorOptions,
		hooks?: ScraperOrchestratorHooks<Ctx>,
		log?: LoggerLike
	): Promise<ScraperOrchestratorResult> {
		const t0 = nowNs();

		const {
			providersOrder,
			minLeads = 1,
			allowUnderDeliveryFallback = false,
		} = options;

		const errors: Partial<Record<LeadProvider, string>> = {};
		const attempts: ScraperAttempt[] = [];

		// Check that at least one adapter is enabled.
		const enabledProviders = providersOrder.filter((p) => {
			const a = this.getAdapter(p);
			return a && a.isEnabled();
		});

		if (enabledProviders.length === 0) {
			throw new Error(
				`No enabled scraper adapters for providers: ${providersOrder.join(
					", "
				)}`
			);
		}

		let bestResult: ScraperAdapterResult | undefined;
		let bestLeadsCount = -1;

		for (const provider of providersOrder) {
			const adapter = this.getAdapter(provider);

			if (!adapter) {
				const attempt: ScraperAttempt = {
					provider,
					status: "NOT_REGISTERED",
					errorMessage: "Adapter not registered in DI container",
				};
				attempts.push(attempt);
				errors[provider] = attempt.errorMessage;
				await hooks?.onProviderSkip?.(provider, attempt);
				continue;
			}

			if (!adapter.isEnabled()) {
				const attempt: ScraperAttempt = {
					provider,
					status: "DISABLED",
					errorMessage: "Adapter disabled",
				};
				attempts.push(attempt);
				errors[provider] = attempt.errorMessage;
				await hooks?.onProviderSkip?.(provider, attempt);
				continue;
			}

			let ctx: Ctx | undefined;
			try {
				ctx = await hooks?.onProviderStart?.(provider);
			} catch (e) {
				// If start hook fails, we still try to scrape (do not block).
				log?.warn(
					{ err: e, provider },
					"ScraperOrchestrator onProviderStart failed"
				);
			}

			try {
				log?.info(
					{
						provider,
						minLeads,
						allowUnderDeliveryFallback,
						limit: query.limit,
					},
					"ScraperOrchestrator: provider started"
				);

				const res = await adapter.scrape(query);
				const leadsCount = res.leads.length;

				const attempt: ScraperAttempt = {
					provider,
					status: "SUCCESS",
					leadsCount,
					providerRunId: res.providerRunId ?? null,
					fileNameHint: res.fileNameHint ?? null,
				};

				// Update "best"
				if (leadsCount > bestLeadsCount) {
					bestLeadsCount = leadsCount;
					bestResult = res;
				}

				// Under-delivery handling (continue or stop)
				if (leadsCount < minLeads && allowUnderDeliveryFallback) {
					attempt.status = "UNDER_DELIVERED";
					attempt.errorMessage = `Under-delivery: got ${leadsCount}, expected >= ${minLeads}`;
					errors[provider] = attempt.errorMessage;
				}

				attempts.push(attempt);

				try {
					await hooks?.onProviderSuccess?.(ctx as Ctx, provider, res, attempt);
				} catch (e) {
					log?.warn(
						{ err: e, provider },
						"ScraperOrchestrator onProviderSuccess failed"
					);
				}

				// Stop condition
				if (leadsCount >= minLeads || !allowUnderDeliveryFallback) {
					log?.info(
						{ provider, leadsCount, durationMs: msSince(t0) },
						"ScraperOrchestrator: finished (stop condition met)"
					);
					return {
						result: res,
						attempts,
						errors,
					};
				}

				// else -> continue to next provider
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);

				const attempt: ScraperAttempt = {
					provider,
					status: "FAILED",
					errorMessage: message,
				};
				attempts.push(attempt);
				errors[provider] = message;

				try {
					await hooks?.onProviderError?.(ctx, provider, err, attempt);
				} catch (e) {
					log?.warn(
						{ err: e, provider },
						"ScraperOrchestrator onProviderError failed"
					);
				}

				log?.warn(
					{ provider, err },
					"ScraperOrchestrator: provider failed (fallback continues)"
				);
				continue;
			}
		}

		if (bestResult) {
			log?.warn(
				{
					bestProvider: bestResult.provider,
					bestLeadsCount,
					durationMs: msSince(t0),
				},
				"ScraperOrchestrator: returning best result after all providers"
			);
			return { result: bestResult, attempts, errors };
		}

		throw new Error(`All scrapers failed: ${JSON.stringify(errors)}`);
	}
}
