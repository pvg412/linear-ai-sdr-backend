import { injectable } from "inversify";
import {
	LeadProvider,
	LeadSearchRunStatus,
	Prisma,
	PrismaClient,
} from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class LeadSearchRunRepository {
	private readonly prisma: PrismaClient = getPrisma();

	async getNextAttempt(
		leadSearchId: string,
		provider: LeadProvider
	): Promise<number> {
		const last = await this.prisma.leadSearchRun.findFirst({
			where: { leadSearchId, provider },
			orderBy: { attempt: "desc" },
			select: { attempt: true },
		});

		return (last?.attempt ?? 0) + 1;
	}

	async findLatestRunningRun(leadSearchId: string, provider: LeadProvider) {
		return this.prisma.leadSearchRun.findFirst({
			where: { leadSearchId, provider, status: LeadSearchRunStatus.RUNNING },
			orderBy: { attempt: "desc" },
		});
	}

	async findRunningRunByExternalRunId(input: {
		leadSearchId: string;
		provider: LeadProvider;
		externalRunId: string;
	}) {
		return this.prisma.leadSearchRun.findFirst({
			where: {
				leadSearchId: input.leadSearchId,
				provider: input.provider,
				status: LeadSearchRunStatus.RUNNING,
				externalRunId: input.externalRunId,
			},
			orderBy: { attempt: "desc" },
		});
	}

	async createRun(input: {
		leadSearchId: string;
		provider: LeadProvider;
		attempt: number;
		triggeredById?: string | null;
		requestPayload?: Prisma.InputJsonValue;
	}) {
		return this.prisma.leadSearchRun.create({
			data: {
				leadSearchId: input.leadSearchId,
				provider: input.provider,
				attempt: input.attempt,
				triggeredById: input.triggeredById ?? null,
				status: LeadSearchRunStatus.RUNNING,
				requestPayload: input.requestPayload ?? undefined,
			},
		});
	}

	/**
	 * Idempotent externalRunId set:
	 * - if null => set
	 * - if already set same => ok
	 * - if already set different => throw (signals double-start bug)
	 */
	async ensureExternalRunId(
		runId: string,
		externalRunId: string
	): Promise<void> {
		const curr = await this.prisma.leadSearchRun.findUnique({
			where: { id: runId },
			select: { externalRunId: true },
		});

		if (!curr) return;

		if (
			typeof curr.externalRunId === "string" &&
			curr.externalRunId.length > 0
		) {
			if (curr.externalRunId !== externalRunId) {
				throw new Error(
					`LeadSearchRun.externalRunId mismatch (runId=${runId} existing=${curr.externalRunId} incoming=${externalRunId})`
				);
			}
			return;
		}

		await this.prisma.leadSearchRun.update({
			where: { id: runId },
			data: { externalRunId },
		});
	}

	async markRunSuccess(input: {
		runId: string;
		leadsCount: number;
		externalRunId?: string | null;
		responseMeta?: Prisma.InputJsonValue;
	}): Promise<void> {
		await this.prisma.leadSearchRun.update({
			where: { id: input.runId },
			data: {
				status: LeadSearchRunStatus.SUCCESS,
				errorMessage: null,
				leadsCount: input.leadsCount,
				externalRunId: input.externalRunId ?? undefined,
				responseMeta: input.responseMeta ?? undefined,
			},
		});
	}

	async markRunFailed(runId: string, errorMessage: string): Promise<void> {
		await this.prisma.leadSearchRun.update({
			where: { id: runId },
			data: {
				status: LeadSearchRunStatus.FAILED,
				errorMessage,
			},
		});
	}
}
