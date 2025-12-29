import { inject, injectable } from "inversify";
import { LeadSearchKind, LeadSearchStatus, Prisma } from "@prisma/client";

import {
	ensureLogger,
	msSince,
	nowNs,
	type LoggerLike,
} from "@/infra/observability";

import { LEAD_DB_TYPES } from "@/capabilities/lead-db/lead-db.types";
import { LeadDbOrchestrator } from "@/capabilities/lead-db/lead-db.orchestrator";
import { mergeAndTrimLeadDbResults } from "@/capabilities/lead-db/lead-db.merger";
import { LeadDbCanonicalFiltersSchema } from "@/capabilities/lead-db/lead-db.dto";

import { LEAD_SEARCH_TYPES } from "@/modules/lead-search/lead-search.types";
import { LeadSearchRepository } from "@/modules/lead-search/persistence/lead-search.repository";
import { LeadSearchRunRepository } from "@/modules/lead-search/persistence/lead-search-run.repository";
import { LeadSearchLeadPersisterService } from "@/modules/lead-search/services/lead-search.lead-persister.service";
import { LeadSearchNotifierService } from "@/modules/lead-search/services/lead-search.notifier.service";

@injectable()
export class LeadDbLeadSearchHandler {
	constructor(
		@inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
		private readonly leadSearchRepository: LeadSearchRepository,

		@inject(LEAD_SEARCH_TYPES.LeadSearchRunRepository)
		private readonly leadSearchRunRepository: LeadSearchRunRepository,

		@inject(LEAD_DB_TYPES.LeadDbOrchestrator)
		private readonly leadDbOrchestrator: LeadDbOrchestrator,

		@inject(LEAD_SEARCH_TYPES.LeadSearchLeadPersisterService)
		private readonly persister: LeadSearchLeadPersisterService,

		@inject(LEAD_SEARCH_TYPES.LeadSearchNotifierService)
		private readonly notifier: LeadSearchNotifierService
	) {}

	async run(
		leadSearchId: string,
		triggeredById?: string,
		log?: LoggerLike
	): Promise<void> {
		const lg = ensureLogger(log);
		const t0 = nowNs();

		const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
		if (!leadSearch) throw new Error("LeadSearch not found");

		if (leadSearch.kind !== LeadSearchKind.LEAD_DB) {
			throw new Error(
				`LeadDbLeadSearchHandler called for kind=${leadSearch.kind}`
			);
		}

		const provider = leadSearch.provider;
		const kind = leadSearch.kind;

		const parsedQuery = LeadDbCanonicalFiltersSchema.safeParse(
			leadSearch.query
		);
		if (!parsedQuery.success) {
			const issues = parsedQuery.error.issues.map((i) => ({
				path: i.path.join("."),
				message: i.message,
			}));

			const msg = `Invalid LeadSearch.query schema: ${JSON.stringify(issues)}`;
			await this.leadSearchRepository.markFailed(leadSearchId, msg);

			await this.notifier.postEvent({
				threadId: leadSearch.threadId,
				leadSearchId,
				text: "Lead search failed: invalid JSON schema.",
				payload: {
					event: "leadSearch.failed",
					leadSearchId,
					status: LeadSearchStatus.FAILED,
					...this.notifier.publicParserMeta(provider),
					kind,
					errorMessage: "Invalid JSON schema.",
					errorDetails: issues,
					durationMs: msSince(t0),
				},
			});

			throw new Error(msg);
		}

		const attempt = await this.leadSearchRunRepository.getNextAttempt(
			leadSearchId,
			provider
		);

		const run = await this.leadSearchRunRepository.createRun({
			leadSearchId,
			provider,
			attempt,
			triggeredById,
			requestPayload: {
				limit: leadSearch.limit,
				query: parsedQuery.data,
			} as Prisma.InputJsonValue,
		});

		await this.leadSearchRepository.markRunning(leadSearchId);

		lg.info(
			{ leadSearchId, provider, attempt, limit: leadSearch.limit },
			"LeadSearch (LEAD_DB) run started"
		);

		try {
			const { providerResults, errors } = await this.leadDbOrchestrator.scrape(
				leadSearchId,
				{
					limit: leadSearch.limit,
					filters: parsedQuery.data,
					fileName: `lead_search_${leadSearchId}`,
				},
				{ providersOrder: [provider] },
				lg.child ? lg.child({ component: "LeadDbOrchestrator" }) : lg
			);

			const merged = mergeAndTrimLeadDbResults(
				providerResults,
				leadSearch.limit
			);

			const insertedLeadIds = await this.persister.persistLeadsAndRelations({
				leadSearchId,
				runId: run.id,
				provider,
				leads: merged,
				createdById: triggeredById,
				log: lg,
			});

			await this.leadSearchRunRepository.markRunSuccess({
				runId: run.id,
				leadsCount: insertedLeadIds.length,
				externalRunId: providerResults[0]?.providerRunId ?? null,
				responseMeta: {
					providerResults: providerResults.map((r) => ({
						provider: r.provider,
						providerRunId: r.providerRunId ?? null,
						fileNameHint: r.fileNameHint ?? null,
						leads: r.leads.length,
					})),
					errors,
				} as Prisma.InputJsonValue,
			});

			await this.leadSearchRepository.markDone(
				leadSearchId,
				insertedLeadIds.length
			);

			const total = insertedLeadIds.length;
			const status =
				total > 0 ? LeadSearchStatus.DONE : LeadSearchStatus.DONE_NO_RESULTS;

			const durationMs = msSince(t0);
			const previewLimit = 100;
			const shown = Math.min(total, previewLimit);

			const previewLeads = merged.slice(0, shown).map((l, idx) => ({
				leadId: insertedLeadIds[idx] ?? null,
				fullName: l.fullName ?? null,
				title: l.title ?? null,
				company: l.company ?? null,
				email: l.email ?? null,
				linkedinUrl: l.linkedinUrl ?? null,
				companyDomain: l.companyDomain ?? null,
				location: l.location ?? null,
			}));

			await this.notifier.postEvent({
				threadId: leadSearch.threadId,
				leadSearchId,
				text:
					status === LeadSearchStatus.DONE_NO_RESULTS
						? "No leads found for these filters"
						: `Lead search completed. Found ${total} leads`,
				payload: {
					event: "leadSearch.completed",
					leadSearchId,
					status,
					...this.notifier.publicParserMeta(provider),
					kind,
					attempt,
					totalLeads: total,
					shownLeads: shown,
					previewLimit,
					previewLeads,
					durationMs,
				},
			});

			lg.info(
				{ leadSearchId, provider, attempt, totalLeads: total, durationMs },
				"LeadSearch (LEAD_DB) run finished"
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await this.leadSearchRunRepository.markRunFailed(run.id, message);
			await this.leadSearchRepository.markFailed(leadSearchId, message);

			await this.notifier.postEvent({
				threadId: leadSearch.threadId,
				leadSearchId,
				text: "Lead search failed.",
				payload: {
					event: "leadSearch.failed",
					leadSearchId,
					status: LeadSearchStatus.FAILED,
					...this.notifier.publicParserMeta(provider),
					kind,
					attempt,
					errorMessage: message,
					durationMs: msSince(t0),
				},
			});

			lg.error(
				{ err, leadSearchId, provider, attempt },
				"LeadSearch (LEAD_DB) run failed"
			);
			throw err;
		}
	}
}
