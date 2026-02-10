import { inject, injectable } from "inversify";
import { type Lead, LeadOrigin, type PrismaClient, UserRole } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";
import {
  ensureLogger,
  isP2002Unique,
  type LoggerLike,
} from "@/infra/observability";
import { UserFacingError } from "@/infra/userFacingError";

import { DATASET_IMPORT_TYPES } from "../dataset-import.types";
import { DatasetImportParserService } from "./dataset-import.parser.service";

export type DatasetImportResult = {
  totalProcessed: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; error: string }[];
};

const BATCH_SIZE = 100;
const MAX_REPORTED_ERRORS = 50;

@injectable()
export class DatasetImportCommandService {
  private readonly prisma: PrismaClient = getPrisma();

  constructor(
    @inject(DATASET_IMPORT_TYPES.DatasetImportParserService)
    private readonly parserService: DatasetImportParserService,
  ) { }

  async importLeads(input: {
    buffer: Buffer;
    ext: "csv" | "xlsx";
    companyId: string;
    log?: LoggerLike;
  }): Promise<DatasetImportResult> {
    const lg = ensureLogger(input.log);

    const { leads } = this.parserService.parseToLeads(input.buffer, input.ext);

    // Validate companyId exists and is a COMPANY role user
    const company = await this.prisma.user.findFirst({
      where: { id: input.companyId, role: UserRole.COMPANY },
      select: { id: true },
    });
    if (!company) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage:
          "Invalid companyId: company not found or user is not a COMPANY role.",
      });
    }

    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const chunk = leads.slice(i, i + BATCH_SIZE);

      await this.prisma.$transaction(async (tx) => {
        for (let j = 0; j < chunk.length; j++) {
          const rowIndex = i + j + 1; // 1-based row number
          try {
            const result = await this.upsertLeadFromImport(tx, {
              lead: chunk[j],
              createdById: input.companyId, // Set createdById to companyId for visibility
            });
            if (result === "created") created++;
            else updated++;
          } catch (err) {
            failed++;
            if (errors.length < MAX_REPORTED_ERRORS) {
              errors.push({
                row: rowIndex,
                error: err instanceof Error ? err.message : String(err),
              });
            }
            lg.warn(
              { row: rowIndex, err: err instanceof Error ? err.message : String(err) },
              "Failed to import lead row",
            );
          }
        }
      });
    }

    lg.info(
      { totalProcessed: leads.length, created, updated, failed },
      "Dataset import completed",
    );

    return { totalProcessed: leads.length, created, updated, failed, errors };
  }

  private async upsertLeadFromImport(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
    input: {
      lead: Record<string, unknown>;
      createdById: string;
    },
  ): Promise<"created" | "updated"> {
    const { lead, createdById } = input;

    const email =
      typeof lead.email === "string"
        ? lead.email.trim().toLowerCase()
        : undefined;
    const linkedinUrl =
      typeof lead.linkedinUrl === "string" && lead.linkedinUrl.trim().length > 0
        ? lead.linkedinUrl.trim()
        : undefined;

    // Find existing by email or linkedinUrl
    let existing: Lead | null = null;
    if (email) {
      existing = await (tx as PrismaClient).lead.findUnique({
        where: { email },
      });
    }
    if (!existing && linkedinUrl) {
      existing = await (tx as PrismaClient).lead.findUnique({
        where: { linkedinUrl },
      });
    }

    const data = {
      firstName: (lead.firstName as string) ?? null,
      lastName: (lead.lastName as string) ?? null,
      fullName: (lead.fullName as string) ?? null,
      title: (lead.title as string) ?? null,
      headline: (lead.headline as string) ?? null,
      linkedinUrl: linkedinUrl ?? null,
      location: (lead.location as string) ?? null,
      email: email ?? null,
      mobileNumber: (lead.mobileNumber as string) ?? null,
      company: (lead.company as string) ?? null,
      companyDomain: (lead.companyDomain as string) ?? null,
      companyUrl: (lead.companyUrl as string) ?? null,
      companyLinkedinUrl: (lead.companyLinkedinUrl as string) ?? null,
      companySize: (lead.companySize as Lead["companySize"]) ?? null,
      companyIndustry: (lead.companyIndustry as string) ?? null,
      companyLocation: (lead.companyLocation as string) ?? null,
      currentPosition: (lead.currentPosition as string) ?? null,
      seniorityLevel: (lead.seniorityLevel as Lead["seniorityLevel"]) ?? null,
      department: (lead.department as string) ?? null,
      yearsInPosition: (lead.yearsInPosition as number) ?? null,
      yearsInCompany: (lead.yearsInCompany as number) ?? null,
      totalExperienceYears: (lead.totalExperienceYears as number) ?? null,
    };

    if (existing) {
      // First-write-wins: only fill in null fields
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (
          value != null &&
          (existing as unknown as Record<string, unknown>)[key] == null
        ) {
          patch[key] = value;
        }
      }

      if (Object.keys(patch).length > 0) {
        try {
          await (tx as PrismaClient).lead.update({
            where: { id: existing.id },
            data: patch,
          });
        } catch (err) {
          if (isP2002Unique(err)) {
            // Unique conflict on update — skip this lead
            // (another import may have just updated it)
          } else {
            throw err;
          }
        }
      }
      return "updated";
    }

    // Create new lead
    try {
      await (tx as PrismaClient).lead.create({
        data: {
          ...data,
          origin: LeadOrigin.CSV_IMPORT,
          createdById,
          isVerified: true,
        },
      });
      return "created";
    } catch (err) {
      if (isP2002Unique(err)) {
        // Race condition: lead was created between our lookup and create
        // Mark as "updated" since the lead now exists
        return "updated";
      }
      throw err;
    }
  }
}
