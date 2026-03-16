import { inject, injectable } from "inversify";
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
import { OBJECT_STORAGE_TYPES } from "@/infra/object-storage/object-storage.types";
import type {
  LeadSearchRawStorage,
  StoredRawRef,
} from "@/infra/object-storage/lead-search-raw.storage";

@injectable()
export class LeadSearchLeadPersisterService {
  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @inject(OBJECT_STORAGE_TYPES.LeadSearchRawStorage)
    private readonly rawStorage: LeadSearchRawStorage,
  ) {}

  private static readonly RAW_FALLBACK_MAX_BYTES = 64 * 1024; // 64 KiB
  private static readonly RAW_FALLBACK_PREVIEW_CHARS = 16_000;

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

    const rawItems: Array<{
      leadId: string;
      providerExternalId: string | null;
      raw: unknown;
    }> = [];

    for (const lead of input.leads) {
      const leadId = await this.upsertLead({
        provider: input.provider,
        createdById: input.createdById,
        lead,
        log: lg,
      });

      leadIds.push(leadId);

      if (input.runId && lead.raw != null) {
        rawItems.push({
          leadId,
          providerExternalId: lead.externalId ?? null,
          raw: lead.raw,
        });
      }
    }

    // Batch-insert lead-search associations in one query instead of N individual
    // upserts. Using createMany + skipDuplicates is equivalent to the previous
    // per-lead upsert({ update: {} }) and avoids N roundtrips to the DB.
    if (leadIds.length > 0) {
      await this.prisma.leadSearchLead.createMany({
        data: leadIds.map((leadId) => ({
          leadSearchId: input.leadSearchId,
          leadId,
        })),
        skipDuplicates: true,
      });
    }

    // Persist raw for the whole run in one object (best-effort).
    let storedRaw: StoredRawRef | null = null;
    if (input.runId && rawItems.length > 0) {
      try {
        storedRaw = await this.rawStorage.putLeadRunRawBundle({
          leadSearchId: input.leadSearchId,
          runId: input.runId,
          provider: input.provider,
          items: rawItems,
        });
      } catch (err) {
        lg.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            leadSearchId: input.leadSearchId,
            runId: input.runId,
            provider: input.provider,
            items: rawItems.length,
          },
          "Failed to persist LeadSearchRunResult.raw bundle to object storage",
        );
      }
    }

    // Upsert per-lead run results, using MinIO reference if available, otherwise DB fallback.
    if (input.runId) {
      for (let i = 0; i < input.leads.length; i++) {
        const lead = input.leads[i];
        const leadId = leadIds[i];
        if (!leadId) continue;

        const rawDbValue = storedRaw
          ? Prisma.DbNull
          : this.buildRawFallbackForDb(lead.raw ?? null);

        await this.prisma.leadSearchRunResult.upsert({
          where: { runId_leadId: { runId: input.runId, leadId } },
          create: {
            runId: input.runId,
            leadId,
            provider: input.provider,
            providerExternalId: lead.externalId ?? null,
            raw: rawDbValue,
            rawBucket: storedRaw ? storedRaw.bucket : null,
            rawObjectKey: storedRaw ? storedRaw.objectKey : null,
            rawContentType: storedRaw ? storedRaw.contentType : null,
            rawContentEncoding: storedRaw ? storedRaw.contentEncoding : null,
            rawSizeBytes: storedRaw ? storedRaw.sizeBytes : null,
            rawEtag: storedRaw ? storedRaw.etag : null,
          },
          update: {
            providerExternalId: lead.externalId ?? null,
            raw: rawDbValue,
            rawBucket: storedRaw ? storedRaw.bucket : null,
            rawObjectKey: storedRaw ? storedRaw.objectKey : null,
            rawContentType: storedRaw ? storedRaw.contentType : null,
            rawContentEncoding: storedRaw ? storedRaw.contentEncoding : null,
            rawSizeBytes: storedRaw ? storedRaw.sizeBytes : null,
            rawEtag: storedRaw ? storedRaw.etag : null,
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
              "Lead update hit unique constraint; retrying without conflicting unique fields",
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
      await this.ensureEmailStatus(existing.id, incoming.emailStatus);
      await this.upsertLeadEmails(existing.id, incoming.emails);
      await this.upsertLeadCompanyWebsites(
        existing.id,
        incoming.companyWebsites,
      );
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

    // 2) Create new lead.
    //
    // The lead record and its provider reference are created inside a single
    // $transaction so that a crash between the two never leaves a lead without
    // a provider ref (which would prevent deduplication on the next import).
    // Email statuses / lead emails / company websites are best-effort and
    // remain outside the transaction intentionally — they can be re-derived
    // from raw data and should not block lead creation on failure.
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({
          data: {
            origin: LeadOrigin.PROVIDER,
            createdById: input.createdById ?? null,
            ...(email ? { email } : {}),
            ...this.pickLeadFields(incoming),
          },
        });

        // Immediately link provider reference within the same transaction
        // so deduplication works correctly on the next import.
        if (externalId) {
          await tx.leadProviderRef.upsert({
            where: {
              provider_externalId: { provider: input.provider, externalId },
            },
            create: { leadId: lead.id, provider: input.provider, externalId },
            update: {},
          });
        }

        return lead;
      });

      // Best-effort calls outside the transaction — failures are logged,
      // not propagated, so they never roll back the lead creation.
      await this.ensureEmailStatus(created.id, incoming.emailStatus);
      await this.upsertLeadEmails(created.id, incoming.emails);
      await this.upsertLeadCompanyWebsites(
        created.id,
        incoming.companyWebsites,
      );
      return created.id;
    } catch (e) {
      // 3) On unique constraint, try reuse instead of failing whole search
      if (isP2002Unique(e)) {
        const target = uniqueTarget(e);

        lg.warn(
          { target, email, linkedinUrl, externalId, provider: input.provider },
          "Lead create hit unique constraint; will try to reuse existing lead",
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
        "Lead create failed",
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
      headline: lead.headline ?? null,
      company: lead.company ?? null,
      companyDomain: lead.companyDomain ?? null,
      companyUrl: lead.companyUrl ?? null,
      companyId: lead.companyId ?? null,
      companyLinkedinUrl: lead.companyLinkedinUrl ?? null,
      companySize: lead.companySize ?? null,
      companyIndustry: lead.companyIndustry ?? null,
      companyLocation: lead.companyLocation ?? null,
      currentPosition: lead.currentPosition ?? null,
      seniorityLevel: lead.seniorityLevel ?? null,
      department: lead.department ?? null,
      yearsInPosition: lead.yearsInPosition ?? null,
      yearsInCompany: lead.yearsInCompany ?? null,
      totalExperienceYears: lead.totalExperienceYears ?? null,
      linkedinUrl: lead.linkedinUrl ?? null,
      location: lead.location ?? null,
      meta: Prisma.DbNull,
    };
  }

  private buildSafeLeadPatch(
    existing: Lead,
    incoming: NormalizedLead,
  ): Prisma.LeadUpdateInput {
    const pick = <T>(
      curr: T | null | undefined,
      next: T | null | undefined,
    ): T | undefined => (curr == null && next != null ? next : undefined);

    return {
      fullName: pick(existing.fullName, incoming.fullName),
      firstName: pick(existing.firstName, incoming.firstName),
      lastName: pick(existing.lastName, incoming.lastName),
      title: pick(existing.title, incoming.title),
      headline: pick(existing.headline, incoming.headline),
      company: pick(existing.company, incoming.company),
      companyDomain: pick(existing.companyDomain, incoming.companyDomain),
      companyUrl: pick(existing.companyUrl, incoming.companyUrl),
      companyId: pick(existing.companyId, incoming.companyId),
      companyLinkedinUrl: pick(
        existing.companyLinkedinUrl,
        incoming.companyLinkedinUrl,
      ),
      companySize: pick(existing.companySize, incoming.companySize),
      companyIndustry: pick(existing.companyIndustry, incoming.companyIndustry),
      companyLocation: pick(existing.companyLocation, incoming.companyLocation),
      currentPosition: pick(existing.currentPosition, incoming.currentPosition),
      seniorityLevel: pick(existing.seniorityLevel, incoming.seniorityLevel),
      department: pick(existing.department, incoming.department),
      yearsInPosition: pick(existing.yearsInPosition, incoming.yearsInPosition),
      yearsInCompany: pick(existing.yearsInCompany, incoming.yearsInCompany),
      totalExperienceYears: pick(
        existing.totalExperienceYears,
        incoming.totalExperienceYears,
      ),
      linkedinUrl: pick(existing.linkedinUrl, incoming.linkedinUrl),
      location: pick(existing.location, incoming.location),
      email: pick(
        existing.email,
        incoming.email ? incoming.email.trim().toLowerCase() : undefined,
      ),
    };
  }

  private async ensureProviderRef(
    leadId: string,
    provider: LeadProvider,
    externalId?: string,
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

  private async ensureEmailStatus(
    leadId: string,
    emailStatus?: NormalizedLead["emailStatus"],
  ): Promise<void> {
    if (!emailStatus) return;

    // Keep it resilient to out-of-date Prisma client typings by using SQL update.
    // Only set status if it's not set yet (first-write-wins).
    await this.prisma.$executeRaw`
			UPDATE "Lead"
			SET "emailStatus" = COALESCE("emailStatus", CAST(${emailStatus} AS "EmailStatus"))
			WHERE "id" = ${leadId}
		`;
  }

  private buildRawFallbackForDb(
    raw: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.DbNull {
    if (raw == null) return Prisma.DbNull;

    try {
      const json = JSON.stringify(raw);
      const bytes = Buffer.byteLength(json, "utf8");

      if (bytes <= LeadSearchLeadPersisterService.RAW_FALLBACK_MAX_BYTES) {
        return raw as Prisma.InputJsonValue;
      }

      const preview = json.slice(
        0,
        LeadSearchLeadPersisterService.RAW_FALLBACK_PREVIEW_CHARS,
      );

      return {
        _hint: "raw_truncated",
        truncated: true,
        originalSizeBytes: bytes,
        previewChars: preview.length,
        preview,
      } as Prisma.InputJsonValue;
    } catch {
      // Worst-case fallback: store a minimal marker so we don't blow up the DB.
      return {
        _hint: "raw_unserializable",
        truncated: true,
      } as Prisma.InputJsonValue;
    }
  }

  private async upsertLeadEmails(
    leadId: string,
    emails?: NormalizedLead["emails"],
  ): Promise<void> {
    if (!emails || emails.length === 0) return;

    for (const emailData of emails) {
      try {
        await this.prisma.leadEmail.upsert({
          where: {
            leadId_email: {
              leadId,
              email: emailData.email.trim().toLowerCase(),
            },
          },
          create: {
            leadId,
            email: emailData.email.trim().toLowerCase(),
            deliverable: emailData.deliverable ?? null,
            catchAllDomain: emailData.catchAllDomain ?? null,
            validEmailServer: emailData.validEmailServer ?? null,
            free: emailData.free ?? null,
            status: emailData.status ?? null,
            qualityScore: emailData.qualityScore ?? null,
            isPrimary: emailData.isPrimary ?? false,
          },
          update: {
            deliverable: emailData.deliverable ?? undefined,
            catchAllDomain: emailData.catchAllDomain ?? undefined,
            validEmailServer: emailData.validEmailServer ?? undefined,
            free: emailData.free ?? undefined,
            status: emailData.status ?? undefined,
            qualityScore: emailData.qualityScore ?? undefined,
            isPrimary: emailData.isPrimary ?? undefined,
          },
        });
      } catch (err) {
        // Log but don't fail the whole lead import
        console.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            leadId,
            email: emailData.email,
          },
          "Failed to upsert LeadEmail",
        );
      }
    }
  }

  private async upsertLeadCompanyWebsites(
    leadId: string,
    websites?: NormalizedLead["companyWebsites"],
  ): Promise<void> {
    if (!websites || websites.length === 0) return;

    for (const website of websites) {
      try {
        await this.prisma.leadCompanyWebsite.upsert({
          where: {
            leadId_domain: {
              leadId,
              domain: website.domain.trim().toLowerCase(),
            },
          },
          create: {
            leadId,
            url: website.url.trim(),
            domain: website.domain.trim().toLowerCase(),
            validEmailServer: website.validEmailServer ?? null,
          },
          update: {
            url: website.url.trim(),
            validEmailServer: website.validEmailServer ?? undefined,
          },
        });
      } catch (err) {
        // Log but don't fail the whole lead import
        console.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            leadId,
            domain: website.domain,
          },
          "Failed to upsert LeadCompanyWebsite",
        );
      }
    }
  }
}
