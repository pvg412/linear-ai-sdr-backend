import { injectable } from "inversify";
import {
	type Lead,
	LeadOrigin,
	LeadProvider,
	Prisma,
	PrismaClient,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import {
	ensureLogger,
	hasAnyDefined,
	isP2002Unique,
	uniqueTarget,
	type LoggerLike,
} from "@/infra/observability";

import { NormalizedLead } from "@/capabilities/shared/leadValidate";

@injectable()
export class LeadSearchLeadPersisterService {
	private readonly prisma: PrismaClient = getPrisma();

	async persistLeadsAndRelations(input: {
		leadSearchId: string;
		runId: string;
		provider: LeadProvider;
		leads: NormalizedLead[];
		createdById?: string;
		log?: LoggerLike;
	}): Promise<string[]> {
		const leadIds: string[] = [];
		const lg = ensureLogger(input.log);

		for (const lead of input.leads) {
			const leadId = await this.upsertLead({
				provider: input.provider,
				createdById: input.createdById,
				lead,
				log: lg,
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
		log?: LoggerLike;
	}): Promise<string> {
		const lg = ensureLogger(input.log);

		const email =
			typeof input.lead.email === "string"
				? input.lead.email.trim().toLowerCase()
				: undefined;

		const linkedinUrl =
			typeof input.lead.linkedinUrl === "string" &&
			input.lead.linkedinUrl.trim().length > 0
				? input.lead.linkedinUrl.trim()
				: undefined;

		const externalId =
			typeof input.lead.externalId === "string" &&
			input.lead.externalId.trim().length > 0
				? input.lead.externalId.trim()
				: undefined;

		const incoming: NormalizedLead = {
			...input.lead,
			email,
			linkedinUrl,
			externalId,
		};

		const tryUpdateExisting = async (existing: Lead): Promise<string> => {
			const patch = this.buildSafeLeadPatch(existing, incoming);

			if (hasAnyDefined(patch as unknown as Record<string, unknown>)) {
				try {
					await this.prisma.lead.update({
						where: { id: existing.id },
						data: patch,
					});
				} catch (e) {
					if (isP2002Unique(e)) {
						const target = uniqueTarget(e);

						lg.warn(
							{
								target,
								leadId: existing.id,
								email,
								linkedinUrl,
								externalId,
								provider: input.provider,
							},
							"Lead update hit unique constraint; retrying without conflicting unique fields"
						);

						const retry: Prisma.LeadUpdateInput = { ...patch };

						if (target.includes("email")) delete retry.email;
						if (target.includes("linkedinUrl")) delete retry.linkedinUrl;

						if (hasAnyDefined(retry as unknown as Record<string, unknown>)) {
							await this.prisma.lead.update({
								where: { id: existing.id },
								data: retry,
							});
						}
					} else {
						throw e;
					}
				}
			}

			await this.ensureProviderRef(existing.id, input.provider, externalId);
			return existing.id;
		};

		// 1) Find existing by stable identifier (email OR linkedin OR provider+externalId)
		if (email) {
			const byEmail = await this.prisma.lead.findUnique({ where: { email } });
			if (byEmail) return tryUpdateExisting(byEmail);
		}

		if (linkedinUrl) {
			const byLinkedin = await this.prisma.lead.findUnique({
				where: { linkedinUrl },
			});
			if (byLinkedin) return tryUpdateExisting(byLinkedin);
		}

		if (externalId) {
			const ref = await this.prisma.leadProviderRef.findUnique({
				where: {
					provider_externalId: { provider: input.provider, externalId },
				},
				select: { leadId: true },
			});

			if (ref?.leadId) {
				const byId = await this.prisma.lead.findUnique({
					where: { id: ref.leadId },
				});
				if (byId) return tryUpdateExisting(byId);
			}
		}

		// 2) Create new lead
		try {
			const created = await this.prisma.lead.create({
				data: {
					origin: LeadOrigin.PROVIDER,
					createdById: input.createdById ?? null,
					...(email ? { email } : {}),
					...this.pickLeadFields(incoming),
				},
			});

			await this.ensureProviderRef(created.id, input.provider, externalId);
			return created.id;
		} catch (e) {
			// 3) On unique constraint, try reuse instead of failing whole search
			if (isP2002Unique(e)) {
				const target = uniqueTarget(e);

				lg.warn(
					{ target, email, linkedinUrl, externalId, provider: input.provider },
					"Lead create hit unique constraint; will try to reuse existing lead"
				);

				const reuse =
					(email
						? await this.prisma.lead.findUnique({ where: { email } })
						: null) ??
					(linkedinUrl
						? await this.prisma.lead.findUnique({ where: { linkedinUrl } })
						: null);

				if (reuse) return tryUpdateExisting(reuse);
			}

			lg.error(
				{ err: e, email, linkedinUrl, externalId, provider: input.provider },
				"Lead create failed"
			);
			throw e;
		}
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
}
