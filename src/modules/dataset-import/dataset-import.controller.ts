import type { FastifyInstance } from "fastify";

import { container } from "@/container";
import { ensureLogger } from "@/infra/observability";
import { requireRequestUser } from "@/infra/auth/requestUser";
import { UserFacingError } from "@/infra/userFacingError";

import { DATASET_IMPORT_TYPES } from "./dataset-import.types";
import type { DatasetImportParserService } from "./services/dataset-import.parser.service";
import type { DatasetImportCommandService } from "./services/dataset-import.command.service";
import type { DatasetImportQueryService } from "./services/dataset-import.query.service";
import { UserRole } from "@prisma/client";

type FileExtension = "csv" | "xlsx";

const ALLOWED_EXTENSIONS = new Set<string>(["csv", "xlsx"]);

function extractFileExtension(filename: string): FileExtension {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new UserFacingError({
      code: "BAD_REQUEST",
      userMessage:
        "Unsupported file type. Please upload a CSV or XLSX file.",
    });
  }
  return ext as FileExtension;
}

function requireAdmin(role: string): void {
  if (role !== UserRole.ADMIN) {
    throw new UserFacingError({
      code: "FORBIDDEN",
      userMessage: "Admin access required.",
    });
  }
}

export function registerDatasetImportRoutes(app: FastifyInstance) {
  const parserService = container.get<DatasetImportParserService>(
    DATASET_IMPORT_TYPES.DatasetImportParserService,
  );
  const commandService = container.get<DatasetImportCommandService>(
    DATASET_IMPORT_TYPES.DatasetImportCommandService,
  );
  const queryService = container.get<DatasetImportQueryService>(
    DATASET_IMPORT_TYPES.DatasetImportQueryService,
  );

  const lg = ensureLogger();

  // Get list of companies for selector
  app.get("/dataset-import/companies", async (req, reply) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    const companies = await queryService.getCompanyList();
    return reply.send(companies);
  });

  // Preview: upload file, validate columns, return mapped preview
  app.post("/dataset-import/preview", async (req, reply) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    const file = await req.file();
    if (!file) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "No file uploaded.",
      });
    }

    const ext = extractFileExtension(file.filename);
    const buffer = await file.toBuffer();
    const result = parserService.parseAndPreview(buffer, ext);

    return reply.send(result);
  });

  // Submit: upload file + companyId, persist leads to database
  app.post("/dataset-import/submit", async (req, reply) => {
    const user = requireRequestUser(req);
    requireAdmin(user.role);

    let fileBuffer: Buffer | null = null;
    let filename: string | null = null;
    let companyId: string | null = null;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        filename = part.filename;
      } else if (part.fieldname === "companyId") {
        companyId =
          typeof part.value === "string" ? part.value.trim() : null;
      }
    }

    if (!fileBuffer || !filename) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "No file uploaded.",
      });
    }
    if (!companyId) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "companyId is required.",
      });
    }

    const ext = extractFileExtension(filename);

    const result = await commandService.importLeads({
      buffer: fileBuffer,
      ext,
      companyId,
      log: lg,
    });

    return reply.code(201).send(result);
  });

  lg.info({}, "DatasetImport controller registered");
}
