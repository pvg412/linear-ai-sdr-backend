import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import { DatasetImportQueryService } from "../services/dataset-import.query.service";

describe("DatasetImportQueryService", () => {
  let queryService: DatasetImportQueryService;

  const userFindManyMock = vi.fn();

  const mockPrisma = {
    user: { findMany: userFindManyMock },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    queryService = new DatasetImportQueryService();
    Object.defineProperty(queryService, "prisma", { value: mockPrisma });
  });

  describe("getCompanyList", () => {
    it("returns list of companies with companyName when available", async () => {
      userFindManyMock.mockResolvedValue([
        { id: "company-1", email: "acme@example.com", companyName: "Acme Corp" },
        { id: "company-2", email: "beta@example.com", companyName: "Beta Inc" },
        { id: "company-3", email: "gamma@example.com", companyName: null },
      ]);

      const result = await queryService.getCompanyList();

      expect(result).toEqual([
        { id: "company-1", name: "Acme Corp" },
        { id: "company-2", name: "Beta Inc" },
        { id: "company-3", name: "gamma@example.com" },
      ]);

      expect(userFindManyMock).toHaveBeenCalledWith({
        where: { role: UserRole.COMPANY },
        select: {
          id: true,
          email: true,
          companyName: true,
        },
        orderBy: { email: "asc" },
      });
    });

    it("returns empty array when no companies exist", async () => {
      userFindManyMock.mockResolvedValue([]);

      const result = await queryService.getCompanyList();

      expect(result).toEqual([]);
    });
  });
});
