import { injectable } from "inversify";
import { parse as parseCsvSync } from "csv-parse/sync";
import * as XLSX from "xlsx";

import { UserFacingError } from "@/infra/userFacingError";
import {
  mapColumns,
  type ColumnMatch,
  type MappingResult,
} from "../column-mapping";

export type DatasetPreviewResult = {
  totalRows: number;
  previewRows: Record<string, unknown>[];
  columnMapping: { csvColumn: string; leadField: string }[];
  unmatchedColumns: string[];
  stats: {
    totalRows: number;
    rowsWithEmail: number;
    rowsWithLinkedin: number;
    uniqueCompanies: number;
  };
};

export type ParsedDataset = {
  leads: Record<string, unknown>[];
  mapping: MappingResult;
};

const PREVIEW_LIMIT = 100;

@injectable()
export class DatasetImportParserService {
  parseAndPreview(
    buffer: Buffer,
    ext: "csv" | "xlsx",
  ): DatasetPreviewResult {
    const rawRows = this.parseFile(buffer, ext);

    if (rawRows.length === 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "File contains no data rows.",
      });
    }

    const headers = Object.keys(rawRows[0]);
    const mapping = mapColumns(headers);

    if (mapping.missingRequired.length > 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: `Missing required columns: ${mapping.missingRequired.join(", ")}`,
        details: {
          missingRequired: mapping.missingRequired,
          matchedColumns: mapping.matched.map((m) => ({
            csvColumn: m.csvColumn,
            mappedTo: m.prismaField,
          })),
          unmatchedColumns: mapping.unmatchedCsvColumns,
        },
      });
    }

    const leads = rawRows.map((row) =>
      this.transformRow(row, mapping.matched),
    );

    return {
      totalRows: leads.length,
      previewRows: leads.slice(0, PREVIEW_LIMIT),
      columnMapping: mapping.matched.map((m) => ({
        csvColumn: m.csvColumn,
        leadField: m.prismaField,
      })),
      unmatchedColumns: mapping.unmatchedCsvColumns,
      stats: {
        totalRows: leads.length,
        rowsWithEmail: leads.filter((l) => l.email).length,
        rowsWithLinkedin: leads.filter((l) => l.linkedinUrl).length,
        uniqueCompanies: new Set(
          leads.map((l) => l.company).filter(Boolean),
        ).size,
      },
    };
  }

  parseToLeads(buffer: Buffer, ext: "csv" | "xlsx"): ParsedDataset {
    const rawRows = this.parseFile(buffer, ext);

    if (rawRows.length === 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "File contains no data rows.",
      });
    }

    const headers = Object.keys(rawRows[0]);
    const mapping = mapColumns(headers);

    if (mapping.missingRequired.length > 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: `Missing required columns: ${mapping.missingRequired.join(", ")}`,
        details: {
          missingRequired: mapping.missingRequired,
          matchedColumns: mapping.matched.map((m) => ({
            csvColumn: m.csvColumn,
            mappedTo: m.prismaField,
          })),
          unmatchedColumns: mapping.unmatchedCsvColumns,
        },
      });
    }

    const leads = rawRows.map((row) =>
      this.transformRow(row, mapping.matched),
    );

    return { leads, mapping };
  }

  private parseFile(
    buffer: Buffer,
    ext: "csv" | "xlsx",
  ): Record<string, string>[] {
    if (ext === "csv") {
      return this.parseCsv(buffer);
    }
    return this.parseXlsx(buffer);
  }

  private parseCsv(buffer: Buffer): Record<string, string>[] {
    try {
      return parseCsvSync<Record<string, string>>(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch (err) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "Failed to parse CSV file. Please check the file format.",
        debugMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private parseXlsx(buffer: Buffer): Record<string, string>[] {
    try {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new UserFacingError({
          code: "BAD_REQUEST",
          userMessage: "XLSX file contains no sheets.",
        });
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
      });
      // Ensure all values are strings
      return (rows as Record<string, unknown>[]).map((row) => {
        const stringRow: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          if (value == null) {
            stringRow[key] = "";
          } else if (typeof value === "string") {
            stringRow[key] = value;
          } else if (typeof value === "number" || typeof value === "boolean") {
            stringRow[key] = String(value);
          } else {
            // Handle objects, arrays, etc.
            stringRow[key] = JSON.stringify(value);
          }
        }
        return stringRow;
      });
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage:
          "Failed to parse XLSX file. Please check the file format.",
        debugMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private transformRow(
    row: Record<string, string>,
    matched: ColumnMatch[],
  ): Record<string, unknown> {
    const lead: Record<string, unknown> = {};
    for (const col of matched) {
      const rawValue = row[col.csvColumn]?.trim();
      if (!rawValue || rawValue === "") continue;
      lead[col.prismaField] = col.transform
        ? col.transform(rawValue)
        : rawValue;
    }
    if (!lead.fullName && (lead.firstName || lead.lastName)) {
      lead.fullName = [lead.firstName, lead.lastName]
        .filter(Boolean)
        .join(" ");
    }

    // Merge virtual _locationCity / _locationState / _locationCountry into location
    if (!lead.location) {
      const parts = [
        lead._locationCity,
        lead._locationState,
        lead._locationCountry,
      ].filter(Boolean);
      if (parts.length > 0) {
        lead.location = parts.join(", ");
      }
    }
    delete lead._locationCity;
    delete lead._locationState;
    delete lead._locationCountry;

    return lead;
  }
}
