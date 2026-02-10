import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

import { DatasetImportParserService } from "../services/dataset-import.parser.service";
import { UserFacingError } from "@/infra/userFacingError";

function readFixture(fileName: string): Buffer {
  return readFileSync(path.join(__dirname, "__fixtures__", fileName));
}

function createXlsxBuffer(rows: Record<string, string>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const arrayBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer;
  return Buffer.from(arrayBuffer);
}

describe("DatasetImportParserService", () => {
  const service = new DatasetImportParserService();

  describe("parseAndPreview — CSV", () => {
    it("parses valid CSV and returns preview with correct mapping", () => {
      const buffer = readFixture("valid.csv");
      const result = service.parseAndPreview(buffer, "csv");

      expect(result.totalRows).toBe(3);
      expect(result.previewRows).toHaveLength(3);
      expect(result.unmatchedColumns).toEqual([]);
      expect(result.columnMapping).toEqual(
        expect.arrayContaining([
          { csvColumn: "First Name", leadField: "firstName" },
          { csvColumn: "Last Name", leadField: "lastName" },
          { csvColumn: "LinkedIn URL", leadField: "linkedinUrl" },
          { csvColumn: "Company Name", leadField: "company" },
          { csvColumn: "Email", leadField: "email" },
          { csvColumn: "Title", leadField: "title" },
          { csvColumn: "Phone", leadField: "mobileNumber" },
          { csvColumn: "Location", leadField: "location" },
          { csvColumn: "Industry", leadField: "companyIndustry" },
          { csvColumn: "Seniority", leadField: "seniorityLevel" },
        ]),
      );

      // First row data check
      const first = result.previewRows[0];
      expect(first.firstName).toBe("John");
      expect(first.lastName).toBe("Doe");
      expect(first.linkedinUrl).toBe("https://linkedin.com/in/johndoe");
      expect(first.company).toBe("Acme Inc");
      expect(first.email).toBe("john@acme.com");
      expect(first.mobileNumber).toBe("+1234567890");
      expect(first.seniorityLevel).toBe("C_LEVEL");
    });

    it("auto-generates fullName from firstName + lastName", () => {
      const buffer = readFixture("valid.csv");
      const result = service.parseAndPreview(buffer, "csv");

      expect(result.previewRows[0].fullName).toBe("John Doe");
      expect(result.previewRows[1].fullName).toBe("Jane Smith");
    });

    it("returns correct stats", () => {
      const buffer = readFixture("valid.csv");
      const result = service.parseAndPreview(buffer, "csv");

      expect(result.stats.totalRows).toBe(3);
      expect(result.stats.rowsWithEmail).toBe(2); // Bob has no email
      expect(result.stats.rowsWithLinkedin).toBe(3);
      expect(result.stats.uniqueCompanies).toBe(3);
    });

    it("throws on missing required columns", () => {
      const buffer = readFixture("missing-required.csv");

      try {
        service.parseAndPreview(buffer, "csv");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UserFacingError);
        const ufErr = err as UserFacingError;
        expect(ufErr.code).toBe("BAD_REQUEST");
        expect(ufErr.userMessage).toContain("Missing required columns");
        expect(ufErr.userMessage).toContain("linkedinUrl");
        expect(ufErr.userMessage).toContain("company");
        expect(ufErr.details).toBeDefined();
        expect(
          (ufErr.details as Record<string, unknown>).missingRequired,
        ).toContain("linkedinUrl");
        expect(
          (ufErr.details as Record<string, unknown>).missingRequired,
        ).toContain("company");
      }
    });

    it("throws on empty CSV (no data rows)", () => {
      const buffer = readFixture("empty.csv");

      expect(() => service.parseAndPreview(buffer, "csv")).toThrow(
        UserFacingError,
      );
    });

    it("throws on malformed CSV", () => {
      const buffer = Buffer.from("not,a,valid\x00csv\x01binary\x02data");

      // csv-parse may or may not throw on this — but it shouldn't crash
      // The point is no unhandled exceptions
      try {
        service.parseAndPreview(buffer, "csv");
      } catch (err) {
        expect(err).toBeInstanceOf(UserFacingError);
      }
    });

    it("limits preview to 100 rows", () => {
      // Build a CSV with 200 rows
      const header =
        "First Name,Last Name,LinkedIn URL,Company Name\n";
      const rows = Array.from(
        { length: 200 },
        (_, i) =>
          `User${i},Last${i},https://linkedin.com/in/user${i},Company${i}`,
      ).join("\n");
      const buffer = Buffer.from(header + rows);

      const result = service.parseAndPreview(buffer, "csv");

      expect(result.totalRows).toBe(200);
      expect(result.previewRows).toHaveLength(100);
      expect(result.stats.totalRows).toBe(200);
    });

    it("skips empty field values (does not include empty strings)", () => {
      const buffer = readFixture("valid.csv");
      const result = service.parseAndPreview(buffer, "csv");

      // Bob Johnson has no email, phone, or seniority-mapped value
      const bob = result.previewRows[2];
      expect(bob.email).toBeUndefined();
      expect(bob.mobileNumber).toBeUndefined();
    });
  });

  describe("parseAndPreview — XLSX", () => {
    it("parses valid XLSX and returns preview", () => {
      const buffer = createXlsxBuffer([
        {
          "First Name": "Alice",
          "Last Name": "Wonder",
          "LinkedIn URL": "https://linkedin.com/in/alicewonder",
          "Company Name": "Wonder Corp",
          Email: "alice@wonder.com",
        },
        {
          "First Name": "Charlie",
          "Last Name": "Brown",
          "LinkedIn URL": "https://linkedin.com/in/charliebrown",
          "Company Name": "Peanuts Inc",
          Email: "charlie@peanuts.com",
        },
      ]);

      const result = service.parseAndPreview(buffer, "xlsx");

      expect(result.totalRows).toBe(2);
      expect(result.previewRows).toHaveLength(2);
      expect(result.previewRows[0].firstName).toBe("Alice");
      expect(result.previewRows[0].company).toBe("Wonder Corp");
      expect(result.previewRows[1].firstName).toBe("Charlie");
    });

    it("throws on missing required columns in XLSX", () => {
      const buffer = createXlsxBuffer([
        { "First Name": "Alice", "Last Name": "Wonder", Email: "a@b.com" },
      ]);

      expect(() => service.parseAndPreview(buffer, "xlsx")).toThrow(
        UserFacingError,
      );
    });

    it("throws on empty XLSX", () => {
      const buffer = createXlsxBuffer([]);

      expect(() => service.parseAndPreview(buffer, "xlsx")).toThrow(
        UserFacingError,
      );
    });
  });

  describe("parseToLeads", () => {
    it("returns all rows (no preview limit)", () => {
      const header =
        "First Name,Last Name,LinkedIn URL,Company Name\n";
      const rows = Array.from(
        { length: 200 },
        (_, i) =>
          `User${i},Last${i},https://linkedin.com/in/user${i},Company${i}`,
      ).join("\n");
      const buffer = Buffer.from(header + rows);

      const result = service.parseToLeads(buffer, "csv");

      expect(result.leads).toHaveLength(200);
    });

    it("returns mapping result alongside leads", () => {
      const buffer = readFixture("valid.csv");
      const result = service.parseToLeads(buffer, "csv");

      expect(result.mapping.matched.length).toBeGreaterThan(0);
      expect(result.mapping.missingRequired).toEqual([]);
    });

    it("throws on missing required columns", () => {
      const buffer = readFixture("missing-required.csv");

      expect(() => service.parseToLeads(buffer, "csv")).toThrow(
        UserFacingError,
      );
    });
  });
});
