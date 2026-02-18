import { describe, it, expect, vi, beforeEach } from "vitest";

import { UserFacingError } from "@/infra/userFacingError";
import { ServiceCatalogCommandService } from "../services/service-catalog.command.service";
import { ServiceCatalogQueryService } from "../services/service-catalog.query.service";
import type { ServiceCatalogRepository } from "../persistence/service-catalog.repository";
import {
  createServiceBodySchema,
  updateServiceBodySchema,
  createSubServiceBodySchema,
  updateSubServiceBodySchema,
} from "../schemas/service-catalog.schemas";

// ── Helper: build mock repository ───────────────────────────────────

function createMockRepo(): Record<keyof ServiceCatalogRepository, ReturnType<typeof vi.fn>> {
  return {
    listByCompany: vi.fn(),
    findServiceById: vi.fn(),
    createService: vi.fn(),
    updateService: vi.fn(),
    deleteService: vi.fn(),
    findSubServiceById: vi.fn(),
    createSubService: vi.fn(),
    updateSubService: vi.fn(),
    deleteSubService: vi.fn(),
  };
}

// ── Helper: build services with injected mock ───────────────────────

function setup() {
  const repo = createMockRepo();

  const commandService = new ServiceCatalogCommandService(
    repo as unknown as ServiceCatalogRepository,
  );

  const queryService = new ServiceCatalogQueryService(
    repo as unknown as ServiceCatalogRepository,
  );

  return { repo, commandService, queryService };
}

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-other";
const SERVICE_ID = "svc-1";
const SUB_SERVICE_ID = "sub-1";

// ═══════════════════════════════════════════════════════════════════
// Command Service
// ═══════════════════════════════════════════════════════════════════

describe("ServiceCatalogCommandService", () => {
  let repo: ReturnType<typeof createMockRepo>;
  let commandService: ServiceCatalogCommandService;

  beforeEach(() => {
    vi.clearAllMocks();
    const s = setup();
    repo = s.repo;
    commandService = s.commandService;
  });

  // ── createService ─────────────────────────────────────────────────

  describe("createService", () => {
    it("creates a service", async () => {
      const created = { id: SERVICE_ID, companyId: COMPANY_ID, name: "DeFi Development" };
      repo.createService.mockResolvedValue(created);

      const result = await commandService.createService(COMPANY_ID, "DeFi Development");

      expect(repo.createService).toHaveBeenCalledWith(COMPANY_ID, "DeFi Development");
      expect(result).toEqual(created);
    });

    it("propagates conflict error for duplicate name", async () => {
      repo.createService.mockRejectedValue(
        new UserFacingError({ code: "CONFLICT", userMessage: "A service with this name already exists" }),
      );

      await expect(
        commandService.createService(COMPANY_ID, "DeFi Development"),
      ).rejects.toThrow(UserFacingError);
    });
  });

  // ── updateService ─────────────────────────────────────────────────

  describe("updateService", () => {
    it("updates a service owned by the company", async () => {
      repo.findServiceById.mockResolvedValue({ id: SERVICE_ID, companyId: COMPANY_ID, name: "Old Name" });
      repo.updateService.mockResolvedValue({ id: SERVICE_ID, companyId: COMPANY_ID, name: "New Name" });

      const result = await commandService.updateService(COMPANY_ID, SERVICE_ID, { name: "New Name" });

      expect(repo.findServiceById).toHaveBeenCalledWith(SERVICE_ID);
      expect(repo.updateService).toHaveBeenCalledWith(SERVICE_ID, { name: "New Name" });
      expect(result.name).toBe("New Name");
    });

    it("throws NOT_FOUND when service belongs to another company", async () => {
      repo.findServiceById.mockResolvedValue({ id: SERVICE_ID, companyId: OTHER_COMPANY_ID, name: "X" });

      await expect(
        commandService.updateService(COMPANY_ID, SERVICE_ID, { name: "Y" }),
      ).rejects.toThrow(UserFacingError);

      await expect(
        commandService.updateService(COMPANY_ID, SERVICE_ID, { name: "Y" }),
      ).rejects.toThrow("Service not found");
    });

    it("throws NOT_FOUND when service does not exist", async () => {
      repo.findServiceById.mockResolvedValue(null);

      await expect(
        commandService.updateService(COMPANY_ID, "nonexistent", { name: "Y" }),
      ).rejects.toThrow(UserFacingError);
    });
  });

  // ── deleteService ─────────────────────────────────────────────────

  describe("deleteService", () => {
    it("deletes a service owned by the company", async () => {
      repo.findServiceById.mockResolvedValue({ id: SERVICE_ID, companyId: COMPANY_ID, name: "X" });
      repo.deleteService.mockResolvedValue(undefined);

      await commandService.deleteService(COMPANY_ID, SERVICE_ID);

      expect(repo.deleteService).toHaveBeenCalledWith(SERVICE_ID);
    });

    it("throws NOT_FOUND when service belongs to another company", async () => {
      repo.findServiceById.mockResolvedValue({ id: SERVICE_ID, companyId: OTHER_COMPANY_ID, name: "X" });

      await expect(
        commandService.deleteService(COMPANY_ID, SERVICE_ID),
      ).rejects.toThrow(UserFacingError);
    });
  });

  // ── createSubService ──────────────────────────────────────────────

  describe("createSubService", () => {
    it("creates a sub-service under an owned service", async () => {
      repo.findServiceById.mockResolvedValue({ id: SERVICE_ID, companyId: COMPANY_ID, name: "X" });
      const created = {
        id: SUB_SERVICE_ID,
        companyServiceCatalogId: SERVICE_ID,
        name: "DEX Development",
        priority: 8,
        budgetMin: 100000,
        budgetMax: 200000,
      };
      repo.createSubService.mockResolvedValue(created);

      const result = await commandService.createSubService(COMPANY_ID, SERVICE_ID, {
        name: "DEX Development",
        priority: 8,
        budgetMin: 100000,
        budgetMax: 200000,
      });

      expect(result).toEqual(created);
    });

    it("rejects when service belongs to another company", async () => {
      repo.findServiceById.mockResolvedValue({ id: SERVICE_ID, companyId: OTHER_COMPANY_ID, name: "X" });

      await expect(
        commandService.createSubService(COMPANY_ID, SERVICE_ID, {
          name: "DEX Development",
          priority: 8,
          budgetMin: 100000,
          budgetMax: 200000,
        }),
      ).rejects.toThrow(UserFacingError);
    });
  });

  // ── updateSubService ──────────────────────────────────────────────

  describe("updateSubService", () => {
    const existingSub = {
      id: SUB_SERVICE_ID,
      companyServiceCatalogId: SERVICE_ID,
      name: "DEX Development",
      priority: 8,
      budgetMin: 100000,
      budgetMax: 200000,
      companyServiceCatalog: { companyId: COMPANY_ID },
    };

    it("updates a sub-service owned by the company", async () => {
      repo.findSubServiceById.mockResolvedValue(existingSub);
      repo.updateSubService.mockResolvedValue({ ...existingSub, priority: 9 });

      const result = await commandService.updateSubService(COMPANY_ID, SUB_SERVICE_ID, {
        priority: 9,
      });

      expect(result.priority).toBe(9);
    });

    it("rejects when sub-service belongs to another company", async () => {
      repo.findSubServiceById.mockResolvedValue({
        ...existingSub,
        companyServiceCatalog: { companyId: OTHER_COMPANY_ID },
      });

      await expect(
        commandService.updateSubService(COMPANY_ID, SUB_SERVICE_ID, { priority: 5 }),
      ).rejects.toThrow(UserFacingError);
    });

    it("rejects when partial budgetMin update would exceed existing budgetMax", async () => {
      repo.findSubServiceById.mockResolvedValue(existingSub);

      // existingSub.budgetMax is 200000, setting budgetMin to 300000 should fail
      await expect(
        commandService.updateSubService(COMPANY_ID, SUB_SERVICE_ID, { budgetMin: 300000 }),
      ).rejects.toThrow("budgetMin must be less than or equal to budgetMax");
    });

    it("rejects when partial budgetMax update would go below existing budgetMin", async () => {
      repo.findSubServiceById.mockResolvedValue(existingSub);

      // existingSub.budgetMin is 100000, setting budgetMax to 50000 should fail
      await expect(
        commandService.updateSubService(COMPANY_ID, SUB_SERVICE_ID, { budgetMax: 50000 }),
      ).rejects.toThrow("budgetMin must be less than or equal to budgetMax");
    });

    it("allows valid partial budget update", async () => {
      repo.findSubServiceById.mockResolvedValue(existingSub);
      repo.updateSubService.mockResolvedValue({ ...existingSub, budgetMax: 500000 });

      const result = await commandService.updateSubService(COMPANY_ID, SUB_SERVICE_ID, {
        budgetMax: 500000,
      });

      expect(result.budgetMax).toBe(500000);
    });
  });

  // ── deleteSubService ──────────────────────────────────────────────

  describe("deleteSubService", () => {
    it("deletes a sub-service owned by the company", async () => {
      repo.findSubServiceById.mockResolvedValue({
        id: SUB_SERVICE_ID,
        companyServiceCatalog: { companyId: COMPANY_ID },
      });
      repo.deleteSubService.mockResolvedValue(undefined);

      await commandService.deleteSubService(COMPANY_ID, SUB_SERVICE_ID);

      expect(repo.deleteSubService).toHaveBeenCalledWith(SUB_SERVICE_ID);
    });

    it("rejects when sub-service does not exist", async () => {
      repo.findSubServiceById.mockResolvedValue(null);

      await expect(
        commandService.deleteSubService(COMPANY_ID, "nonexistent"),
      ).rejects.toThrow(UserFacingError);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Query Service
// ═══════════════════════════════════════════════════════════════════

describe("ServiceCatalogQueryService", () => {
  let repo: ReturnType<typeof createMockRepo>;
  let queryService: ServiceCatalogQueryService;

  beforeEach(() => {
    vi.clearAllMocks();
    const s = setup();
    repo = s.repo;
    queryService = s.queryService;
  });

  it("returns services with computed aggregates", async () => {
    repo.listByCompany.mockResolvedValue([
      {
        id: "svc-1",
        companyId: COMPANY_ID,
        name: "DeFi Development",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-01"),
        subServices: [
          { id: "sub-1", companyServiceCatalogId: "svc-1", name: "DEX", priority: 8, budgetMin: 100000, budgetMax: 200000, createdAt: new Date(), updatedAt: new Date() },
          { id: "sub-2", companyServiceCatalogId: "svc-1", name: "Lending", priority: 6, budgetMin: 50000, budgetMax: 150000, createdAt: new Date(), updatedAt: new Date() },
        ],
      },
    ]);

    const result = await queryService.listServiceCatalog(COMPANY_ID);

    expect(result).toHaveLength(1);
    expect(result[0].priorityAvg).toBe(7);       // (8+6)/2
    expect(result[0].budgetMinAvg).toBe(75000);   // (100000+50000)/2
    expect(result[0].budgetMaxAvg).toBe(175000);  // (200000+150000)/2
    expect(result[0].subServices).toHaveLength(2);
  });

  it("returns null aggregates for services with 0 sub-services", async () => {
    repo.listByCompany.mockResolvedValue([
      {
        id: "svc-1",
        companyId: COMPANY_ID,
        name: "Empty Service",
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-01"),
        subServices: [],
      },
    ]);

    const result = await queryService.listServiceCatalog(COMPANY_ID);

    expect(result[0].priorityAvg).toBeNull();
    expect(result[0].budgetMinAvg).toBeNull();
    expect(result[0].budgetMaxAvg).toBeNull();
  });

  it("rounds averages to 2 decimal places", async () => {
    repo.listByCompany.mockResolvedValue([
      {
        id: "svc-1",
        companyId: COMPANY_ID,
        name: "Service",
        createdAt: new Date(),
        updatedAt: new Date(),
        subServices: [
          { id: "sub-1", companyServiceCatalogId: "svc-1", name: "A", priority: 7, budgetMin: 10000, budgetMax: 30000, createdAt: new Date(), updatedAt: new Date() },
          { id: "sub-2", companyServiceCatalogId: "svc-1", name: "B", priority: 8, budgetMin: 20000, budgetMax: 40000, createdAt: new Date(), updatedAt: new Date() },
          { id: "sub-3", companyServiceCatalogId: "svc-1", name: "C", priority: 9, budgetMin: 15000, budgetMax: 35000, createdAt: new Date(), updatedAt: new Date() },
        ],
      },
    ]);

    const result = await queryService.listServiceCatalog(COMPANY_ID);

    expect(result[0].priorityAvg).toBe(8);         // (7+8+9)/3 = 8
    expect(result[0].budgetMinAvg).toBe(15000);     // (10000+20000+15000)/3 = 15000
    expect(result[0].budgetMaxAvg).toBe(35000);     // (30000+40000+35000)/3 = 35000
  });

  it("returns empty array when company has no services", async () => {
    repo.listByCompany.mockResolvedValue([]);

    const result = await queryService.listServiceCatalog(COMPANY_ID);

    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Zod Schemas (validation)
// ═══════════════════════════════════════════════════════════════════

describe("service-catalog schemas", () => {
  describe("createServiceBodySchema", () => {
    it("accepts valid name", () => {
      const result = createServiceBodySchema.parse({ name: "DeFi Development" });
      expect(result.name).toBe("DeFi Development");
    });

    it("trims whitespace", () => {
      const result = createServiceBodySchema.parse({ name: "  DeFi  " });
      expect(result.name).toBe("DeFi");
    });

    it("rejects name shorter than 2 chars", () => {
      expect(() => createServiceBodySchema.parse({ name: "X" })).toThrow();
    });

    it("rejects name longer than 120 chars", () => {
      expect(() => createServiceBodySchema.parse({ name: "A".repeat(121) })).toThrow();
    });

    it("rejects empty body", () => {
      expect(() => createServiceBodySchema.parse({})).toThrow();
    });
  });

  describe("updateServiceBodySchema", () => {
    it("accepts partial update with name", () => {
      const result = updateServiceBodySchema.parse({ name: "New Name" });
      expect(result.name).toBe("New Name");
    });

    it("rejects empty body", () => {
      expect(() => updateServiceBodySchema.parse({})).toThrow();
    });
  });

  describe("createSubServiceBodySchema", () => {
    const valid = { name: "DEX Development", priority: 8, budgetMin: 100000, budgetMax: 200000 };

    it("accepts valid sub-service", () => {
      const result = createSubServiceBodySchema.parse(valid);
      expect(result).toEqual(valid);
    });

    it("rejects priority below 1", () => {
      expect(() => createSubServiceBodySchema.parse({ ...valid, priority: 0 })).toThrow();
    });

    it("rejects priority above 10", () => {
      expect(() => createSubServiceBodySchema.parse({ ...valid, priority: 11 })).toThrow();
    });

    it("rejects non-integer priority", () => {
      expect(() => createSubServiceBodySchema.parse({ ...valid, priority: 5.5 })).toThrow();
    });

    it("rejects negative budgetMin", () => {
      expect(() => createSubServiceBodySchema.parse({ ...valid, budgetMin: -1 })).toThrow();
    });

    it("rejects budgetMin > budgetMax", () => {
      expect(() =>
        createSubServiceBodySchema.parse({ ...valid, budgetMin: 300000, budgetMax: 200000 }),
      ).toThrow();
    });

    it("accepts budgetMin === budgetMax", () => {
      const result = createSubServiceBodySchema.parse({ ...valid, budgetMin: 100000, budgetMax: 100000 });
      expect(result.budgetMin).toBe(result.budgetMax);
    });

    it("rejects missing required fields", () => {
      expect(() => createSubServiceBodySchema.parse({ name: "Test" })).toThrow();
    });
  });

  describe("updateSubServiceBodySchema", () => {
    it("accepts partial update", () => {
      const result = updateSubServiceBodySchema.parse({ priority: 5 });
      expect(result.priority).toBe(5);
    });

    it("rejects empty body", () => {
      expect(() => updateSubServiceBodySchema.parse({})).toThrow();
    });

    it("rejects when both budgets provided and min > max", () => {
      expect(() =>
        updateSubServiceBodySchema.parse({ budgetMin: 500000, budgetMax: 100000 }),
      ).toThrow();
    });

    it("allows single budget field (cross-validation done in service)", () => {
      const result = updateSubServiceBodySchema.parse({ budgetMin: 50000 });
      expect(result.budgetMin).toBe(50000);
    });
  });
});
