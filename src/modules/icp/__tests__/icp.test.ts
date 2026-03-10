import { describe, it, expect, vi, beforeEach } from "vitest";

import { IcpRepository } from "../persistence/icp.repository";
import { upsertIcpBodySchema, COMPANY_SIZE_OPTIONS } from "../schemas/icp.schemas";

// ═══════════════════════════════════════════════════════════════════
// Zod Schemas
// ═══════════════════════════════════════════════════════════════════

describe("upsertIcpBodySchema", () => {
  it("accepts valid full payload", () => {
    const result = upsertIcpBodySchema.parse({
      locations: ["San Francisco, CA", "London, United Kingdom"],
      companySizes: ["B", "C", "D"],
      industries: [
        { industryId: "96", label: "IT Services and IT Consulting" },
        { industryId: "4", label: "Computer Software" },
      ],
    });

    expect(result.locations).toHaveLength(2);
    expect(result.companySizes).toEqual(["B", "C", "D"]);
    expect(result.industries).toHaveLength(2);
  });

  it("defaults all arrays to empty when omitted", () => {
    const result = upsertIcpBodySchema.parse({});

    expect(result.locations).toEqual([]);
    expect(result.companySizes).toEqual([]);
    expect(result.industries).toEqual([]);
  });

  it("accepts empty arrays explicitly", () => {
    const result = upsertIcpBodySchema.parse({
      locations: [],
      companySizes: [],
      industries: [],
    });

    expect(result.locations).toEqual([]);
    expect(result.companySizes).toEqual([]);
    expect(result.industries).toEqual([]);
  });

  // ── Location validation ───────────────────────────────────────────

  describe("locations", () => {
    it("trims whitespace from locations", () => {
      const result = upsertIcpBodySchema.parse({
        locations: ["  San Francisco  "],
      });
      expect(result.locations[0]).toBe("San Francisco");
    });

    it("rejects empty string location", () => {
      expect(() =>
        upsertIcpBodySchema.parse({ locations: [""] }),
      ).toThrow();
    });

    it("rejects location longer than 200 characters", () => {
      expect(() =>
        upsertIcpBodySchema.parse({ locations: ["A".repeat(201)] }),
      ).toThrow();
    });

    it("rejects duplicate locations (case-insensitive)", () => {
      expect(() =>
        upsertIcpBodySchema.parse({
          locations: ["San Francisco", "san francisco"],
        }),
      ).toThrow("Duplicate locations");
    });

    it("rejects more than 50 locations", () => {
      const locations = Array.from({ length: 51 }, (_, i) => `City ${i}`);
      expect(() =>
        upsertIcpBodySchema.parse({ locations }),
      ).toThrow();
    });
  });

  // ── Company size validation ───────────────────────────────────────

  describe("companySizes", () => {
    it("accepts all valid codes A-I", () => {
      const allCodes = COMPANY_SIZE_OPTIONS.map((o) => o.code);
      const result = upsertIcpBodySchema.parse({ companySizes: [...allCodes] });
      expect(result.companySizes).toHaveLength(9);
    });

    it("rejects invalid size code", () => {
      expect(() =>
        upsertIcpBodySchema.parse({ companySizes: ["Z"] }),
      ).toThrow();
    });

    it("rejects lowercase size code", () => {
      expect(() =>
        upsertIcpBodySchema.parse({ companySizes: ["a"] }),
      ).toThrow();
    });

    it("rejects duplicate size codes", () => {
      expect(() =>
        upsertIcpBodySchema.parse({ companySizes: ["A", "B", "A"] }),
      ).toThrow("Duplicate company size");
    });
  });

  // ── Industry validation ───────────────────────────────────────────

  describe("industries", () => {
    it("accepts valid industry objects", () => {
      const result = upsertIcpBodySchema.parse({
        industries: [{ industryId: "96", label: "IT Services" }],
      });
      expect(result.industries[0].industryId).toBe("96");
    });

    it("trims industry fields", () => {
      const result = upsertIcpBodySchema.parse({
        industries: [{ industryId: "  96  ", label: "  IT Services  " }],
      });
      expect(result.industries[0].industryId).toBe("96");
      expect(result.industries[0].label).toBe("IT Services");
    });

    it("rejects empty industryId", () => {
      expect(() =>
        upsertIcpBodySchema.parse({
          industries: [{ industryId: "", label: "IT Services" }],
        }),
      ).toThrow();
    });

    it("rejects empty label", () => {
      expect(() =>
        upsertIcpBodySchema.parse({
          industries: [{ industryId: "96", label: "" }],
        }),
      ).toThrow();
    });

    it("rejects label longer than 200 characters", () => {
      expect(() =>
        upsertIcpBodySchema.parse({
          industries: [{ industryId: "96", label: "A".repeat(201) }],
        }),
      ).toThrow();
    });

    it("rejects duplicate industry IDs", () => {
      expect(() =>
        upsertIcpBodySchema.parse({
          industries: [
            { industryId: "96", label: "IT Services" },
            { industryId: "96", label: "IT Services Duplicate" },
          ],
        }),
      ).toThrow("Duplicate industry");
    });

    it("rejects more than 100 industries", () => {
      const industries = Array.from({ length: 101 }, (_, i) => ({
        industryId: String(i),
        label: `Industry ${i}`,
      }));
      expect(() =>
        upsertIcpBodySchema.parse({ industries }),
      ).toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// COMPANY_SIZE_OPTIONS reference data
// ═══════════════════════════════════════════════════════════════════

describe("COMPANY_SIZE_OPTIONS", () => {
  it("has exactly 9 entries (A through I)", () => {
    expect(COMPANY_SIZE_OPTIONS).toHaveLength(9);
  });

  it("has unique codes", () => {
    const codes = COMPANY_SIZE_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("starts with A and ends with I", () => {
    expect(COMPANY_SIZE_OPTIONS[0].code).toBe("A");
    expect(COMPANY_SIZE_OPTIONS[8].code).toBe("I");
  });
});

// ═══════════════════════════════════════════════════════════════════
// IcpRepository (with mock Prisma)
// ═══════════════════════════════════════════════════════════════════

describe("IcpRepository", () => {
  let repo: IcpRepository;

  const findUniqueMock = vi.fn();
  const transactionMock = vi.fn();

  const COMPANY_ID = "company-1";
  const CONFIG_ID = "icp-config-1";

  const mockConfig = {
    id: CONFIG_ID,
    companyId: COMPANY_ID,
    locations: ["San Francisco, CA"],
    companySizes: ["B", "C"],
    createdAt: new Date(),
    updatedAt: new Date(),
    industries: [
      { id: "ind-1", configId: CONFIG_ID, industryId: "96", label: "IT Services", createdAt: new Date() },
    ],
  };

  const mockPrisma = {
    companyIcpConfig: {
      findUnique: findUniqueMock,
    },
    $transaction: transactionMock,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    repo = new IcpRepository();
    Object.defineProperty(repo, "prisma", { value: mockPrisma, writable: true });
  });

  describe("getByCompanyId", () => {
    it("returns config with industries when found", async () => {
      findUniqueMock.mockResolvedValue(mockConfig);

      const result = await repo.getByCompanyId(COMPANY_ID);

      expect(result).toEqual(mockConfig);
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        include: { industries: { orderBy: { createdAt: "asc" } } },
      });
    });

    it("returns null when no config exists", async () => {
      findUniqueMock.mockResolvedValue(null);

      const result = await repo.getByCompanyId(COMPANY_ID);

      expect(result).toBeNull();
    });
  });

  describe("upsert", () => {
    it("calls $transaction with the correct callback", async () => {
      const upsertMock = vi.fn().mockResolvedValue({ id: CONFIG_ID });
      const findOrThrowMock = vi.fn().mockResolvedValue(mockConfig);
      const deleteManyMock = vi.fn().mockResolvedValue({ count: 0 });
      const createManyMock = vi.fn().mockResolvedValue({ count: 1 });

      transactionMock.mockImplementation((fn: (tx: unknown) => unknown) => {
        const txClient = {
          companyIcpConfig: {
            upsert: upsertMock,
            findUniqueOrThrow: findOrThrowMock,
          },
          companyIcpIndustry: {
            deleteMany: deleteManyMock,
            createMany: createManyMock,
          },
        };
        return Promise.resolve(fn(txClient));
      });

      const result = await repo.upsert(COMPANY_ID, {
        locations: ["New York"],
        companySizes: ["D"],
        industries: [{ industryId: "96", label: "IT Services" }],
      });

      expect(upsertMock).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        create: {
          companyId: COMPANY_ID,
          locations: ["New York"],
          companySizes: ["D"],
        },
        update: {
          locations: ["New York"],
          companySizes: ["D"],
        },
      });

      expect(deleteManyMock).toHaveBeenCalledWith({
        where: { configId: CONFIG_ID },
      });

      expect(createManyMock).toHaveBeenCalledWith({
        data: [{ configId: CONFIG_ID, industryId: "96", label: "IT Services" }],
      });

      expect(result).toEqual(mockConfig);
    });

    it("skips createMany when industries array is empty", async () => {
      const upsertMock = vi.fn().mockResolvedValue({ id: CONFIG_ID });
      const findOrThrowMock = vi.fn().mockResolvedValue({
        ...mockConfig,
        industries: [],
      });
      const deleteManyMock = vi.fn().mockResolvedValue({ count: 0 });
      const createManyMock = vi.fn();

      transactionMock.mockImplementation((fn: (tx: unknown) => unknown) => {
        const txClient = {
          companyIcpConfig: {
            upsert: upsertMock,
            findUniqueOrThrow: findOrThrowMock,
          },
          companyIcpIndustry: {
            deleteMany: deleteManyMock,
            createMany: createManyMock,
          },
        };
        return Promise.resolve(fn(txClient));
      });

      await repo.upsert(COMPANY_ID, {
        locations: [],
        companySizes: [],
        industries: [],
      });

      expect(createManyMock).not.toHaveBeenCalled();
      expect(deleteManyMock).toHaveBeenCalled();
    });
  });
});
