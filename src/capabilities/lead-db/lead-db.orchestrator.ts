import { injectable, multiInject } from "inversify";
import { LeadProvider } from "@prisma/client";

import type {
	LeadDbAdapter,
	LeadDbAdapterResult,
	LeadDbOrchestratorOptions,
	LeadDbOrchestratorResult,
	LeadDbQuery,
} from "./lead-db.dto";
import { LEAD_DB_TYPES } from "./lead-db.types";
import { msSince, nowNs, type LoggerLike } from "@/infra/observability";

@injectable()
export class LeadDbOrchestrator {
	constructor(
		@multiInject(LEAD_DB_TYPES.LeadDbAdapter)
		private readonly adapters: LeadDbAdapter[]
	) {}

	private getAdapter(provider: LeadProvider): LeadDbAdapter | undefined {
		return this.adapters.find((a) => a.provider === provider);
	}

	/**
	 * Sequential orchestrator.
	 * - No DB writes here (runner owns persistence + statuses).
	 * - Tries providers in order.
	 * - Can stop on first success (default true).
	 */
	async scrape(
		leadSearchId: string,
		query: LeadDbQuery,
		options: LeadDbOrchestratorOptions,
		log?: LoggerLike
	): Promise<LeadDbOrchestratorResult> {
		const t0 = nowNs();

		const providersOrder = options.providersOrder ?? [];
		if (providersOrder.length === 0) {
			throw new Error("LeadDbOrchestrator: providersOrder is empty");
		}

		const stopOnFirstSuccess = options.stopOnFirstSuccess ?? true;

		const errors: Partial<Record<LeadProvider, string>> = {};
		const providerResults: LeadDbAdapterResult[] = [];

		log?.info(
			{ leadSearchId, providersOrder, stopOnFirstSuccess, limit: query.limit },
			"Lead DB orchestrator: starting (sequential)"
		);

		for (const provider of providersOrder) {
			const adapter = this.getAdapter(provider);

			if (!adapter) {
				const msg = "Adapter is not registered in DI container";
				errors[provider] = msg;
				log?.error({ leadSearchId, provider }, msg);
				continue;
			}

			if (!adapter.isEnabled()) {
				const msg = "Adapter is disabled (missing API key or disabled flag)";
				errors[provider] = msg;
				log?.warn({ leadSearchId, provider }, msg);
				continue;
			}

			try {
				const r = await adapter.scrape(query);

				providerResults.push(r);

				log?.info(
					{
						leadSearchId,
						provider,
						leads: r.leads.length,
						providerRunId: r.providerRunId ?? undefined,
						fileNameHint: r.fileNameHint ?? undefined,
					},
					"Lead DB provider succeeded"
				);

				if (stopOnFirstSuccess) break;
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				errors[provider] = message;
				log?.error({ err, leadSearchId, provider }, "Lead DB provider failed");
				// continue to next provider (fallback)
			}
		}

		if (providerResults.length === 0) {
			throw new Error(
				`All lead DB providers failed (sequential): ${JSON.stringify(errors)}`
			);
		}

		log?.info(
			{
				leadSearchId,
				durationMs: msSince(t0),
				succeededProviders: providerResults.map((r) => r.provider),
				failedProviders: Object.keys(errors),
			},
			"Lead DB orchestrator: finished (sequential)"
		);

		return { providerResults, errors };
	}
}
