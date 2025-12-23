import { inject, injectable } from "inversify";
import {
	ChatMessageRole,
	ChatMessageType,
	type Lead,
	LeadOrigin,
	LeadProvider,
	LeadSearchKind,
	LeadSearchStatus,
	Prisma,
	PrismaClient,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import { msSince, nowNs, type LoggerLike } from "@/infra/observability";

import { LEAD_DB_TYPES } from "@/capabilities/lead-db/lead-db.types";
import { LeadDbOrchestrator } from "@/capabilities/lead-db/lead-db.orchestrator";
import { mergeAndTrimLeadDbResults } from "@/capabilities/lead-db/lead-db.merger";
import { LeadDbCanonicalFiltersSchema } from "@/capabilities/lead-db/lead-db.dto";
import { NormalizedLead } from "@/capabilities/shared/leadValidate";

import { SCRAPER_TYPES } from "@/capabilities/scraper/scraper.types";
import { ScraperOrchestrator } from "@/capabilities/scraper/scraper.orchestrator";
import {
	ScrapeQuerySchema,
	type ScrapeQuery,
} from "@/capabilities/scraper/scraper.dto";
import { RealtimeHub } from "@/infra/realtime/realtimeHub";
import { REALTIME_TYPES } from "@/infra/realtime/realtime.types";

import { LEAD_SEARCH_TYPES } from "./lead-search.types";
import { LeadSearchRepository } from "./lead-search.repository";

@injectable()
export class LeadSearchRunnerService {
	private readonly prisma: PrismaClient = getPrisma();

	constructor(
		@inject(LEAD_SEARCH_TYPES.LeadSearchRepository)
		private readonly leadSearchRepository: LeadSearchRepository,

		@inject(LEAD_DB_TYPES.LeadDbOrchestrator)
		private readonly leadDbOrchestrator: LeadDbOrchestrator,

		@inject(SCRAPER_TYPES.ScraperOrchestrator)
		private readonly scraperOrchestrator: ScraperOrchestrator,

		@inject(REALTIME_TYPES.RealtimeHub)
		private readonly realtimeHub: RealtimeHub
	) {}

	/**
	 * Fire-and-forget launch.
	 * good enough for single-process dev; for production use a queue/worker.
	 */
	dispatch(
		leadSearchId: string,
		triggeredById?: string,
		log?: LoggerLike
	): void {
		setImmediate(() => {
			void this.run(leadSearchId, triggeredById, log).catch((err) => {
				log?.error(
					{ err: err as Error, leadSearchId },
					"LeadSearchRunner dispatch failed"
				);
			});
		});
	}

	async run(
		leadSearchId: string,
		triggeredById?: string,
		log?: LoggerLike
	): Promise<void> {
		const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
		if (!leadSearch) throw new Error("LeadSearch not found");

		if (leadSearch.kind === LeadSearchKind.LEAD_DB) {
			await this.runLeadDb(leadSearchId, triggeredById, log);
			return;
		}

		if (leadSearch.kind === LeadSearchKind.SCRAPER) {
			// TODO: Scraper is not supported yet.
			// await this.runScraper(leadSearchId, triggeredById, log);
			return;
		}

		const _exhaustive: never = leadSearch.kind;
		throw new Error(`LeadSearch kind=${String(_exhaustive)} is not supported`);
	}

	// -------------------------
	// LEAD_DB
	// -------------------------
	private async runLeadDb(
		leadSearchId: string,
		triggeredById?: string,
		log?: LoggerLike
	): Promise<void> {
		const t0 = nowNs();

		const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
		if (!leadSearch) throw new Error("LeadSearch not found");

		const provider = leadSearch.provider;
		const kind = leadSearch.kind;

		// Validate stored query JSON (user could edit it)
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

			await this.postChatEventIfAny(leadSearch.threadId, leadSearchId, {
				text: "Lead search failed: invalid JSON schema.",
				payload: {
					event: "leadSearch.failed",
					leadSearchId,
					status: LeadSearchStatus.FAILED,
					provider,
					kind,
					errorMessage: "Invalid JSON schema.",
					errorDetails: issues,
					durationMs: msSince(t0),
				},
			});

			throw new Error(msg);
		}

		const attempt = await this.leadSearchRepository.getNextAttempt(
			leadSearchId,
			provider
		);

		const run = await this.leadSearchRepository.createRun({
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

		log?.info(
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
				log?.child ? log.child({ component: "LeadDbOrchestrator" }) : log
			);

			const merged = mergeAndTrimLeadDbResults(
				providerResults,
				leadSearch.limit
			);

			const insertedLeadIds = await this.persistLeadsAndRelations({
				leadSearchId,
				runId: run.id,
				provider,
				leads: merged,
				createdById: triggeredById,
			});

			await this.leadSearchRepository.markRunSuccess({
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

			const text =
				status === LeadSearchStatus.DONE_NO_RESULTS
					? `No leads found for these filters`
					: `Lead search completed. Found ${total} leads`;

			await this.postChatEventIfAny(leadSearch.threadId, leadSearchId, {
				text,
				payload: {
					event: "leadSearch.completed",
					leadSearchId,
					status,
					provider,
					kind,
					attempt,
					totalLeads: total,
					shownLeads: shown,
					previewLimit,
					previewLeads,
					durationMs,
				},
			});

			log?.info(
				{ leadSearchId, provider, attempt, totalLeads: total, durationMs },
				"LeadSearch (LEAD_DB) run finished"
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await this.leadSearchRepository.markRunFailed(run.id, message);
			await this.leadSearchRepository.markFailed(leadSearchId, message);

			await this.postChatEventIfAny(leadSearch.threadId, leadSearchId, {
				text: "Lead search failed.",
				payload: {
					event: "leadSearch.failed",
					leadSearchId,
					status: LeadSearchStatus.FAILED,
					provider,
					kind,
					attempt,
					errorMessage: message,
					durationMs: msSince(t0),
				},
			});

			log?.error(
				{ err, leadSearchId, provider, attempt },
				"LeadSearch (LEAD_DB) run failed"
			);
			throw err;
		}
	}

	// -------------------------
	// SCRAPER (new)
	// -------------------------
	private async runScraper(
		leadSearchId: string,
		triggeredById?: string,
		log?: LoggerLike
	): Promise<void> {
		const t0 = nowNs();

		const leadSearch = await this.leadSearchRepository.getById(leadSearchId);
		if (!leadSearch) throw new Error("LeadSearch not found");

		const kind = leadSearch.kind;
		const providerSelected = leadSearch.provider;

		const queryObj =
			leadSearch.query &&
			typeof leadSearch.query === "object" &&
			!Array.isArray(leadSearch.query)
				? (leadSearch.query as Record<string, unknown>)
				: {};

		const parsedQuery = ScrapeQuerySchema.safeParse({
			...queryObj,
			limit: leadSearch.limit,
		});

		if (!parsedQuery.success) {
			const issues = parsedQuery.error.issues.map((i) => ({
				path: i.path.join("."),
				message: i.message,
			}));

			const msg = `Invalid LeadSearch.query schema for SCRAPER: ${JSON.stringify(
				issues
			)}`;
			await this.leadSearchRepository.markFailed(leadSearchId, msg);

			await this.postChatEventIfAny(leadSearch.threadId, leadSearchId, {
				text: "Lead search failed: invalid JSON schema.",
				payload: {
					event: "leadSearch.failed",
					leadSearchId,
					status: LeadSearchStatus.FAILED,
					provider: providerSelected,
					kind,
					errorMessage: "Invalid JSON schema.",
					errorDetails: issues,
					durationMs: msSince(t0),
				},
			});

			throw new Error(msg);
		}

		const scrapeQuery: ScrapeQuery = parsedQuery.data;

		await this.leadSearchRepository.markRunning(leadSearchId);

		log?.info(
			{ leadSearchId, provider: providerSelected, limit: leadSearch.limit },
			"LeadSearch (SCRAPER) run started"
		);

		const providersOrder: LeadProvider[] = [providerSelected];

		const runCtxByProvider = new Map<
			LeadProvider,
			{ runId: string; attempt: number }
		>();

		try {
			const { result, errors, attempts } =
				await this.scraperOrchestrator.scrapeWithFallback(
					scrapeQuery,
					{
						providersOrder,
						minLeads: leadSearch.limit,
						allowUnderDeliveryFallback: true,
					},
					{
						onProviderStart: async (provider) => {
							const attempt = await this.leadSearchRepository.getNextAttempt(
								leadSearchId,
								provider
							);
							const run = await this.leadSearchRepository.createRun({
								leadSearchId,
								provider,
								attempt,
								triggeredById,
								requestPayload: {
									limit: leadSearch.limit,
									query: scrapeQuery,
								} as Prisma.InputJsonValue,
							});

							runCtxByProvider.set(provider, { runId: run.id, attempt });
							return { runId: run.id, attempt };
						},
						onProviderSuccess: async (ctx, provider, res, attemptInfo) => {
							const attemptMeta: Prisma.InputJsonObject = {
								provider: attemptInfo.provider,
								status: attemptInfo.status,
								...(typeof attemptInfo.leadsCount === "number"
									? { leadsCount: attemptInfo.leadsCount }
									: {}),
								...(attemptInfo.providerRunId !== undefined
									? { providerRunId: attemptInfo.providerRunId ?? null }
									: {}),
								...(attemptInfo.fileNameHint !== undefined
									? { fileNameHint: attemptInfo.fileNameHint ?? null }
									: {}),
								...(attemptInfo.errorMessage !== undefined
									? { errorMessage: attemptInfo.errorMessage }
									: {}),
							};

							const responseMeta: Prisma.InputJsonObject = {
								attempt: attemptMeta,
								fileNameHint: res.fileNameHint ?? null,
							};

							await this.leadSearchRepository.markRunSuccess({
								runId: ctx.runId,
								leadsCount: res.leads.length,
								externalRunId: res.providerRunId ?? null,
								responseMeta,
							});
						},
						onProviderError: async (ctx, provider, err, attemptInfo) => {
							const message = err instanceof Error ? err.message : String(err);

							if (ctx && typeof ctx.runId === "string") {
								await this.leadSearchRepository.markRunFailed(
									ctx.runId,
									message
								);
							}

							log?.warn(
								{ provider, attemptInfo, err },
								"Scraper provider failed"
							);
						},
						onProviderSkip: (provider, attemptInfo) => {
							log?.info({ provider, attemptInfo }, "Scraper provider skipped");
						},
					},
					log?.child ? log.child({ component: "ScraperOrchestrator" }) : log
				);

			const insertedLeadIds = await this.persistLeadsAndRelations({
				leadSearchId,
				runId:
					runCtxByProvider.get(result.provider)?.runId ??
					runCtxByProvider.get(providerSelected)?.runId ??
					"",
				provider: result.provider,
				leads: result.leads,
				createdById: triggeredById,
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

			const previewLeads = result.leads.slice(0, shown).map((l, idx) => ({
				leadId: insertedLeadIds[idx] ?? null,
				fullName: l.fullName ?? null,
				title: l.title ?? null,
				company: l.company ?? null,
				email: l.email ?? null,
				linkedinUrl: l.linkedinUrl ?? null,
				companyDomain: l.companyDomain ?? null,
				location: l.location ?? null,
			}));

			const provider = result.provider;

			const text =
				status === LeadSearchStatus.DONE_NO_RESULTS
					? `No leads found for these filters`
					: `Lead search completed. Found ${total} leads`;

			await this.postChatEventIfAny(leadSearch.threadId, leadSearchId, {
				text,
				payload: {
					event: "leadSearch.completed",
					leadSearchId,
					status,
					provider,
					kind,
					attempts,
					errors,
					totalLeads: total,
					shownLeads: shown,
					previewLimit,
					previewLeads,
					durationMs,
				},
			});

			log?.info(
				{ leadSearchId, provider, totalLeads: total, durationMs },
				"LeadSearch (SCRAPER) run finished"
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			await this.leadSearchRepository.markFailed(leadSearchId, message);

			await this.postChatEventIfAny(leadSearch.threadId, leadSearchId, {
				text: "Lead search failed.",
				payload: {
					event: "leadSearch.failed",
					leadSearchId,
					status: LeadSearchStatus.FAILED,
					provider: providerSelected,
					kind,
					errorMessage: message,
					durationMs: msSince(t0),
				},
			});

			log?.error(
				{ err, leadSearchId, provider: providerSelected },
				"LeadSearch (SCRAPER) run failed"
			);
			throw err;
		}
	}

	// -------------------------
	// Persistence (unchanged)
	// -------------------------
	private async persistLeadsAndRelations(input: {
		leadSearchId: string;
		runId: string;
		provider: LeadProvider;
		leads: NormalizedLead[];
		createdById?: string;
	}): Promise<string[]> {
		const leadIds: string[] = [];

		for (const lead of input.leads) {
			const leadId = await this.upsertLead({
				provider: input.provider,
				createdById: input.createdById,
				lead,
			});

			leadIds.push(leadId);

			await this.prisma.leadSearchLead.upsert({
				where: {
					leadSearchId_leadId: {
						leadSearchId: input.leadSearchId,
						leadId,
					},
				},
				create: {
					leadSearchId: input.leadSearchId,
					leadId,
				},
				update: {},
			});

			if (input.runId) {
				await this.prisma.leadSearchRunResult.upsert({
					where: {
						runId_leadId: { runId: input.runId, leadId },
					},
					create: {
						runId: input.runId,
						leadId,
						provider: input.provider,
						providerExternalId: lead.externalId ?? null,
						raw: (lead.raw ?? null) as Prisma.InputJsonValue,
					},
					update: {
						providerExternalId: lead.externalId ?? null,
						raw: (lead.raw ?? null) as Prisma.InputJsonValue,
					},
				});
			}
		}

		return leadIds;
	}

	private async upsertLead(input: {
		provider: LeadProvider;
		createdById?: string;
		lead: NormalizedLead;
	}): Promise<string> {
		const email =
			typeof input.lead.email === "string"
				? input.lead.email.trim().toLowerCase()
				: undefined;
		const linkedinUrl = input.lead.linkedinUrl ?? undefined;
		const externalId = input.lead.externalId ?? undefined;

		if (email) {
			const existing = await this.prisma.lead.findUnique({ where: { email } });
			if (existing) {
				await this.prisma.lead.update({
					where: { id: existing.id },
					data: this.buildSafeLeadPatch(existing, { ...input.lead, email }),
				});
				await this.ensureProviderRef(existing.id, input.provider, externalId);
				return existing.id;
			}

			const created = await this.prisma.lead.create({
				data: {
					origin: LeadOrigin.PROVIDER,
					createdById: input.createdById ?? null,
					email,
					...this.pickLeadFields(input.lead),
				},
			});

			await this.ensureProviderRef(created.id, input.provider, externalId);
			return created.id;
		}

		if (linkedinUrl) {
			const existing = await this.prisma.lead.findUnique({
				where: { linkedinUrl },
			});
			if (existing) {
				await this.prisma.lead.update({
					where: { id: existing.id },
					data: this.buildSafeLeadPatch(existing, input.lead),
				});
				await this.ensureProviderRef(existing.id, input.provider, externalId);
				return existing.id;
			}

			const created = await this.prisma.lead.create({
				data: {
					origin: LeadOrigin.PROVIDER,
					createdById: input.createdById ?? null,
					...this.pickLeadFields(input.lead),
				},
			});

			await this.ensureProviderRef(created.id, input.provider, externalId);
			return created.id;
		}

		if (externalId) {
			const ref = await this.prisma.leadProviderRef.findUnique({
				where: {
					provider_externalId: { provider: input.provider, externalId },
				},
				select: { leadId: true },
			});

			if (ref?.leadId) {
				const existing = await this.prisma.lead.findUnique({
					where: { id: ref.leadId },
				});
				if (existing) {
					await this.prisma.lead.update({
						where: { id: existing.id },
						data: this.buildSafeLeadPatch(existing, input.lead),
					});
					return existing.id;
				}
			}
		}

		const created = await this.prisma.lead.create({
			data: {
				origin: LeadOrigin.PROVIDER,
				createdById: input.createdById ?? null,
				...this.pickLeadFields(input.lead),
			},
		});

		await this.ensureProviderRef(created.id, input.provider, externalId);
		return created.id;
	}

	private pickLeadFields(lead: NormalizedLead) {
		return {
			fullName: lead.fullName ?? null,
			firstName: lead.firstName ?? null,
			lastName: lead.lastName ?? null,
			title: lead.title ?? null,
			company: lead.company ?? null,
			companyDomain: lead.companyDomain ?? null,
			companyUrl: lead.companyUrl ?? null,
			linkedinUrl: lead.linkedinUrl ?? null,
			location: lead.location ?? null,
			meta: Prisma.DbNull,
		};
	}

	private buildSafeLeadPatch(
		existing: Lead,
		incoming: NormalizedLead
	): Prisma.LeadUpdateInput {
		const pick = <T>(
			curr: T | null | undefined,
			next: T | null | undefined
		): T | undefined => (curr == null && next != null ? next : undefined);

		return {
			fullName: pick(existing.fullName, incoming.fullName),
			firstName: pick(existing.firstName, incoming.firstName),
			lastName: pick(existing.lastName, incoming.lastName),
			title: pick(existing.title, incoming.title),
			company: pick(existing.company, incoming.company),
			companyDomain: pick(existing.companyDomain, incoming.companyDomain),
			companyUrl: pick(existing.companyUrl, incoming.companyUrl),
			linkedinUrl: pick(existing.linkedinUrl, incoming.linkedinUrl),
			location: pick(existing.location, incoming.location),
			email: pick(
				existing.email,
				incoming.email ? incoming.email.trim().toLowerCase() : undefined
			),
		};
	}

	private async ensureProviderRef(
		leadId: string,
		provider: LeadProvider,
		externalId?: string
	): Promise<void> {
		if (!externalId) return;

		try {
			await this.prisma.leadProviderRef.create({
				data: { leadId, provider, externalId },
			});
		} catch (err) {
			const e = err as { code?: string };
			if (e?.code === "P2002") return;
			throw err;
		}
	}

	private async postChatEventIfAny(
		threadId: string | null,
		leadSearchId: string,
		input: { text: string; payload: Record<string, unknown> }
	): Promise<void> {
		if (!threadId) return;

		const message = await this.prisma.chatMessage.create({
			data: {
				threadId,
				role: ChatMessageRole.ASSISTANT,
				type: ChatMessageType.EVENT,
				text: input.text,
				payload: input.payload as Prisma.InputJsonValue,
				leadSearchId,
				authorUserId: null,
			},
		});

		await this.prisma.chatThread.update({
			where: { id: threadId },
			data: { lastMessageAt: new Date() },
		});

		this.realtimeHub.broadcast(threadId, {
			type: "message.created",
			payload: { message },
		});
	}
}
