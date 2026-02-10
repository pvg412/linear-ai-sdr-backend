import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserFacingError } from "@/infra/userFacingError";
import { DatasetImportCommandService } from "../services/dataset-import.command.service";
import { DatasetImportParserService } from "../services/dataset-import.parser.service";
import { UserRole } from "@prisma/client";

describe("DatasetImportCommandService", () => {
  let commandService: DatasetImportCommandService;
  let parserService: DatasetImportParserService;

  const leadFindUniqueMock = vi.fn();
  const leadCreateMock = vi.fn();
  const leadUpdateMock = vi.fn();
  const userFindFirstMock = vi.fn();
  const transactionMock = vi.fn();

  const mockPrisma = {
    user: { findFirst: userFindFirstMock },
    lead: {
      findUnique: leadFindUniqueMock,
      create: leadCreateMock,
      update: leadUpdateMock,
    },
    $transaction: transactionMock,
  };

  const validCsv = Buffer.from(
    [
      "First Name,Last Name,LinkedIn URL,Company Name,Email",
      "John,Doe,https://linkedin.com/in/johndoe,Acme Inc,john@acme.com",
      "Jane,Smith,https://linkedin.com/in/janesmith,Beta Corp,jane@beta.com",
    ].join("\n"),
  );

  beforeEach(() => {
    vi.clearAllMocks();

    parserService = new DatasetImportParserService();
    commandService = new DatasetImportCommandService(parserService);

    // Override the private prisma property with our mock
    Object.defineProperty(commandService, "prisma", { value: mockPrisma });

    // Default: $transaction executes the callback directly with the mock
    transactionMock.mockImplementation((fn: (tx: unknown) => unknown) => {
      const txClient = {
        lead: {
          findUnique: leadFindUniqueMock,
          create: leadCreateMock,
          update: leadUpdateMock,
        },
      };
      return Promise.resolve(fn(txClient));
    });
  });

  it("throws when companyId is invalid", async () => {
    userFindFirstMock.mockResolvedValue(null);

    await expect(
      commandService.importLeads({
        buffer: validCsv,
        ext: "csv",
        companyId: "nonexistent",
      }),
    ).rejects.toThrow(UserFacingError);

    expect(userFindFirstMock).toHaveBeenCalledWith({
      where: { id: "nonexistent", role: UserRole.COMPANY },
      select: { id: true },
    });
  });

  it("creates new leads when none exist", async () => {
    userFindFirstMock.mockResolvedValue({ id: "company-1" });
    leadFindUniqueMock.mockResolvedValue(null);
    leadCreateMock.mockResolvedValue({ id: "lead-1" });

    const result = await commandService.importLeads({
      buffer: validCsv,
      ext: "csv",
      companyId: "company-1",
    });

    expect(result.totalProcessed).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);

    expect(leadCreateMock).toHaveBeenCalledTimes(2);
    const firstCall = leadCreateMock.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    const firstCallData = firstCall[0].data;
    expect(firstCallData.firstName).toBe("John");
    expect(firstCallData.lastName).toBe("Doe");
    expect(firstCallData.email).toBe("john@acme.com");
    expect(firstCallData.linkedinUrl).toBe(
      "https://linkedin.com/in/johndoe",
    );
    expect(firstCallData.company).toBe("Acme Inc");
    expect(firstCallData.createdById).toBe("company-1"); // companyId as createdById
    expect(firstCallData.origin).toBe("CSV_IMPORT");
    expect(firstCallData.isVerified).toBe(true);
  });

  it("updates existing leads found by email", async () => {
    userFindFirstMock.mockResolvedValue({ id: "company-1" });

    leadFindUniqueMock.mockImplementation(
      (args: { where: { email?: string; linkedinUrl?: string } }) => {
        if (args.where.email === "john@acme.com") {
          return Promise.resolve({
            id: "existing-lead-1",
            email: "john@acme.com",
            firstName: "John",
            lastName: null,
            linkedinUrl: null,
            company: "Acme Inc",
            companyId: null,
            title: null,
            headline: null,
            fullName: null,
            location: null,
            mobileNumber: null,
            companyDomain: null,
            companyUrl: null,
            companyLinkedinUrl: null,
            companySize: null,
            companyIndustry: null,
            companyLocation: null,
            currentPosition: null,
            seniorityLevel: null,
            department: null,
            yearsInPosition: null,
            yearsInCompany: null,
            totalExperienceYears: null,
          });
        }
        return Promise.resolve(null);
      },
    );
    leadCreateMock.mockResolvedValue({ id: "lead-2" });
    leadUpdateMock.mockResolvedValue({ id: "existing-lead-1" });

    const result = await commandService.importLeads({
      buffer: validCsv,
      ext: "csv",
      companyId: "company-1",
    });

    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);

    expect(leadUpdateMock).toHaveBeenCalledTimes(1);
    const updateCall = leadUpdateMock.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    const updateData = updateCall[0].data;
    expect(updateData.lastName).toBe("Doe");
  });

  it("counts failed rows and continues processing", async () => {
    userFindFirstMock.mockResolvedValue({ id: "company-1" });
    leadFindUniqueMock.mockResolvedValue(null);

    leadCreateMock
      .mockResolvedValueOnce({ id: "lead-1" })
      .mockRejectedValueOnce(new Error("DB connection lost"));

    const result = await commandService.importLeads({
      buffer: validCsv,
      ext: "csv",
      companyId: "company-1",
    });

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
    expect(result.errors[0].error).toContain("DB connection lost");
  });

  it("throws on missing required columns in the file", async () => {
    userFindFirstMock.mockResolvedValue({ id: "company-1" });

    const invalidCsv = Buffer.from(
      ["First Name,Last Name,Email", "John,Doe,john@acme.com"].join("\n"),
    );

    await expect(
      commandService.importLeads({
        buffer: invalidCsv,
        ext: "csv",
        companyId: "company-1",
      }),
    ).rejects.toThrow(UserFacingError);
  });
});
