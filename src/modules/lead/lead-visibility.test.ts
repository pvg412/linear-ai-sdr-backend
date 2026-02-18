import { describe, expect, it } from "vitest";
import { buildLeadVisibilityWhere } from "./lead-visibility";

describe("buildLeadVisibilityWhere", () => {
  const ownerId = "user_1";
  const companyId = "company_1";

  it("ADMIN sees everything (empty filter)", () => {
    const where = buildLeadVisibilityWhere({
      ownerId,
      role: "ADMIN",
    });
    expect(where).toEqual({});
  });

  it("ADMIN with companyId still sees everything", () => {
    const where = buildLeadVisibilityWhere({
      ownerId,
      role: "ADMIN",
      companyId,
    });
    expect(where).toEqual({});
  });

  it("COMPANY role uses ownerId as effectiveCompanyId", () => {
    // COMPANY user has companyId=null, but they ARE the company.
    // Their members have companyId pointing to this user's id.
    const where = buildLeadVisibilityWhere({
      ownerId,
      role: "COMPANY",
      companyId: null,
    });
    expect(where).toEqual({
      OR: [
        { createdBy: { companyId: ownerId } },
        { createdById: ownerId },
      ],
    });
  });

  it("COMPANY role ignores companyId even if somehow provided", () => {
    const where = buildLeadVisibilityWhere({
      ownerId,
      role: "COMPANY",
      companyId: "some_other_id",
    });
    // Should still use ownerId, not the provided companyId
    expect(where).toEqual({
      OR: [
        { createdBy: { companyId: ownerId } },
        { createdById: ownerId },
      ],
    });
  });

  it("SALE_MANAGER with companyId sees company-wide leads", () => {
    const where = buildLeadVisibilityWhere({
      ownerId,
      role: "SALE_MANAGER",
      companyId,
    });
    expect(where).toEqual({
      OR: [
        { createdBy: { companyId } },
        { createdById: companyId },
      ],
    });
  });

  it("SALE_MANAGER without companyId sees only own leads", () => {
    const where = buildLeadVisibilityWhere({
      ownerId,
      role: "SALE_MANAGER",
      companyId: null,
    });
    expect(where).toEqual({ createdById: ownerId });
  });

  it("no role and no companyId falls back to own leads", () => {
    const where = buildLeadVisibilityWhere({
      ownerId,
    });
    expect(where).toEqual({ createdById: ownerId });
  });

  it("no role but with companyId uses company-wide filter", () => {
    const where = buildLeadVisibilityWhere({
      ownerId,
      companyId,
    });
    expect(where).toEqual({
      OR: [
        { createdBy: { companyId } },
        { createdById: companyId },
      ],
    });
  });
});
