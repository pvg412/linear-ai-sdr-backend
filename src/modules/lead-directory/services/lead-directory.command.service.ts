import { inject, injectable } from "inversify";
import { Prisma } from "@prisma/client";
import { ensureLogger, type LoggerLike } from "@/infra/observability";

import { LEAD_DIRECTORY_TYPES } from "../lead-directory.types";
import {
  LeadDirectoryConflictError,
  LeadDirectoryNotFoundError,
  LeadDirectoryForbiddenError,
  LeadDirectoryValidationError,
} from "../lead-directory.errors";
import {
  LeadDirectoryRepository,
  type LeadDirectoryDto,
} from "../persistence/lead-directory.repository";
import { LEAD_RAG_TYPES } from "@/modules/lead-rag/lead-rag.types";
import { LeadRagIndexSyncService } from "@/modules/lead-rag/services/lead-rag-index-sync.service";

const DIRECTORY_NAME_REGEX = /^[A-Za-z0-9]+$/;

function normalizeDirectoryName(raw: string): string {
  return raw.trim();
}

function assertValidDirectoryName(raw: string): string {
  const name = normalizeDirectoryName(raw);

  if (name.length === 0) {
    throw new LeadDirectoryValidationError("Directory name must not be empty");
  }
  if (name.length > 200) {
    throw new LeadDirectoryValidationError(
      "Directory name must be at most 200 characters",
    );
  }
  if (!DIRECTORY_NAME_REGEX.test(name)) {
    throw new LeadDirectoryValidationError(
      "Directory name must contain only English letters and digits (A-Z, a-z, 0-9)",
    );
  }

  return name;
}

function isPrismaUniqueConstraintError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
  );
}

function isPrismaForeignKeyConstraintError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003"
  );
}

@injectable()
export class LeadDirectoryCommandService {
  constructor(
    @inject(LEAD_DIRECTORY_TYPES.LeadDirectoryRepository)
    private readonly leadDirectoryRepository: LeadDirectoryRepository,
    @inject(LEAD_RAG_TYPES.LeadRagIndexSyncService)
    private readonly ragSync: LeadRagIndexSyncService,
  ) {}

  async createDirectory(
    ownerId: string,
    input: {
      name: string;
      parentId: string | null;
      description?: string | null;
      position?: number;
    },
    log?: LoggerLike,
  ): Promise<LeadDirectoryDto> {
    const lg = ensureLogger(log);

    const name = assertValidDirectoryName(input.name);
    const existing = await this.leadDirectoryRepository.findOwnedByName({
      ownerId,
      name,
    });
    if (existing) {
      throw new LeadDirectoryConflictError("Directory name already exists");
    }

    if (input.parentId) {
      const parent = await this.leadDirectoryRepository.findOwnedById({
        ownerId,
        directoryId: input.parentId,
      });
      if (!parent)
        throw new LeadDirectoryNotFoundError("Parent directory not found");
    }

    let created: LeadDirectoryDto;
    try {
      created = await this.leadDirectoryRepository.create({
        ownerId,
        name,
        parentId: input.parentId,
        description: input.description ?? null,
        position: input.position,
      });
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        throw new LeadDirectoryConflictError("Directory name already exists");
      }
      throw e;
    }

    lg.info(
      { ownerId, directoryId: created.id, parentId: created.parentId },
      "LeadDirectory created",
    );
    return created;
  }

  async updateDirectory(
    ownerId: string,
    directoryId: string,
    patch: { name?: string; description?: string | null; position?: number },
    log?: LoggerLike,
  ): Promise<LeadDirectoryDto> {
    const lg = ensureLogger(log);

    const current = await this.leadDirectoryRepository.findOwnedById({
      ownerId,
      directoryId,
    });
    if (!current) throw new LeadDirectoryNotFoundError("Directory not found");

    const nextName =
      patch.name !== undefined
        ? assertValidDirectoryName(patch.name)
        : undefined;
    if (nextName !== undefined) {
      const existing = await this.leadDirectoryRepository.findOwnedByName({
        ownerId,
        name: nextName,
      });
      if (existing && existing.id !== directoryId) {
        throw new LeadDirectoryConflictError("Directory name already exists");
      }
    }

    let updated: LeadDirectoryDto | null;
    try {
      updated = await this.leadDirectoryRepository.updateOwned({
        ownerId,
        directoryId,
        data: {
          ...(nextName !== undefined ? { name: nextName } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description }
            : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
        },
      });
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        throw new LeadDirectoryConflictError("Directory name already exists");
      }
      throw e;
    }

    if (!updated) throw new LeadDirectoryNotFoundError("Directory not found");

    lg.info({ ownerId, directoryId }, "LeadDirectory updated");
    return updated;
  }

  async moveDirectory(
    ownerId: string,
    directoryId: string,
    parentId: string | null,
    log?: LoggerLike,
  ): Promise<LeadDirectoryDto> {
    const lg = ensureLogger(log);

    const dir = await this.leadDirectoryRepository.findOwnedById({
      ownerId,
      directoryId,
    });
    if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");

    if (parentId === directoryId) {
      throw new LeadDirectoryValidationError(
        "Cannot set directory parent to itself",
      );
    }

    if (parentId) {
      const parent = await this.leadDirectoryRepository.findOwnedById({
        ownerId,
        directoryId: parentId,
      });
      if (!parent)
        throw new LeadDirectoryNotFoundError(
          "Target parent directory not found",
        );

      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === directoryId) {
          throw new LeadDirectoryConflictError(
            "Cannot move directory into its own subtree",
          );
        }
        cursor = await this.leadDirectoryRepository.findOwnedParentId({
          ownerId,
          directoryId: cursor,
        });
      }
    }

    const updated = await this.leadDirectoryRepository.updateOwned({
      ownerId,
      directoryId,
      data: { parentId },
    });

    if (!updated) throw new LeadDirectoryNotFoundError("Directory not found");

    lg.info({ ownerId, directoryId, parentId }, "LeadDirectory moved");
    return updated;
  }

  async deleteDirectory(
    ownerId: string,
    directoryId: string,
    log?: LoggerLike,
  ): Promise<void> {
    const lg = ensureLogger(log);

    const leadIds =
      await this.leadDirectoryRepository.deleteOwnedAndListLeadIds({
        ownerId,
        directoryId,
      });
    if (leadIds === null)
      throw new LeadDirectoryNotFoundError("Directory not found");

    await this.ragSync.enqueueUpsertLeads(ownerId, leadIds, {
      reason: "directory.delete",
      log: lg,
    });

    lg.info({ ownerId, directoryId }, "LeadDirectory deleted");
  }

  async addLead(
    ownerId: string,
    directoryId: string,
    leadId: string,
    log?: LoggerLike,
  ): Promise<void> {
    const lg = ensureLogger(log);

    const dir = await this.leadDirectoryRepository.findOwnedById({
      ownerId,
      directoryId,
    });
    if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");

    const lead = await this.leadDirectoryRepository.getLeadStatus({
      ownerId,
      leadId,
    });
    if (!lead.exists) throw new LeadDirectoryNotFoundError("Lead not found");
    if (!lead.isVerified) {
      throw new LeadDirectoryForbiddenError("Lead is not verified");
    }

    try {
      await this.leadDirectoryRepository.addLeadToDirectory({
        directoryId,
        leadId,
      });
    } catch (e) {
      // Directory might have been deleted after we checked it exists.
      if (isPrismaForeignKeyConstraintError(e)) {
        throw new LeadDirectoryNotFoundError("Directory not found");
      }
      throw e;
    }

    await this.ragSync.enqueueUpsertLead(ownerId, leadId, {
      reason: "directory.addLead",
      log: lg,
    });

    lg.info({ ownerId, directoryId, leadId }, "Lead added to directory");
  }

  async removeLead(
    ownerId: string,
    directoryId: string,
    leadId: string,
    log?: LoggerLike,
  ): Promise<void> {
    const lg = ensureLogger(log);

    const dir = await this.leadDirectoryRepository.findOwnedById({
      ownerId,
      directoryId,
    });
    if (!dir) throw new LeadDirectoryNotFoundError("Directory not found");

    await this.leadDirectoryRepository.removeLeadFromDirectory({
      ownerId,
      directoryId,
      leadId,
    });

    await this.ragSync.enqueueUpsertLead(ownerId, leadId, {
      reason: "directory.removeLead",
      log: lg,
    });

    lg.info({ ownerId, directoryId, leadId }, "Lead removed from directory");
  }
}
