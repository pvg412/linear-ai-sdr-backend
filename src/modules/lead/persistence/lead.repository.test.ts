import { describe, expect, it } from "vitest";

import { UNASSIGNED_DIRECTORY_ID } from "@/modules/lead-directory/lead-directory.unassigned";
import { buildLeadWhere } from "./lead.repository";

describe("buildLeadWhere", () => {
  const ownerId = "user_1";
  const ownerVisibility = {
    OR: [
      { createdById: ownerId },
      { searches: { some: { leadSearch: { createdById: ownerId } } } },
      { leadDirectoryLeads: { some: { directory: { ownerId } } } },
    ],
  };

  const companyId = "company_1";
  const companyVisibility = {
    OR: [
      { createdById: ownerId },
      { createdBy: { companyId } },
      {
        searches: {
          some: {
            leadSearch: {
              OR: [
                { createdById: ownerId },
                { createdBy: { companyId } },
              ],
            },
          },
        },
      },
      { leadDirectoryLeads: { some: { directory: { ownerId } } } },
      {
        leadDirectoryLeads: {
          some: { directory: { owner: { companyId } } },
        },
      },
    ],
  };

  it("adds isVerified=true by default", () => {
    const where = buildLeadWhere({ ownerId });
    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(
      expect.arrayContaining([{ isVerified: true }, ownerVisibility]),
    );
  });

  it("does not add isVerified=true when includeUnverified=true", () => {
    const where = buildLeadWhere({ ownerId, includeUnverified: true });
    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(expect.arrayContaining([ownerVisibility]));
    expect(
      andFilters.some(
        (f) => (f as { isVerified?: boolean }).isVerified === true,
      ),
    ).toBe(false);
  });

  it("supports search across multiple fields (contains, insensitive)", () => {
    const where = buildLeadWhere({
      ownerId,
      filters: { search: "Acme" },
    });

    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(
      expect.arrayContaining([
        ownerVisibility,
        { isVerified: true },
        {
          OR: [
            { fullName: { contains: "Acme", mode: "insensitive" } },
            { firstName: { contains: "Acme", mode: "insensitive" } },
            { lastName: { contains: "Acme", mode: "insensitive" } },
            { email: { contains: "Acme", mode: "insensitive" } },
            { title: { contains: "Acme", mode: "insensitive" } },
            { company: { contains: "Acme", mode: "insensitive" } },
            { companyDomain: { contains: "Acme", mode: "insensitive" } },
            { companyUrl: { contains: "Acme", mode: "insensitive" } },
            { linkedinUrl: { contains: "Acme", mode: "insensitive" } },
            { location: { contains: "Acme", mode: "insensitive" } },
          ],
        },
      ]),
    );
  });

  it("supports directoryIds with OR semantics (any selected directory)", () => {
    const where = buildLeadWhere({
      ownerId,
      filters: { directoryIds: ["dir_a", "dir_b"] },
    });

    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(
      expect.arrayContaining([
        ownerVisibility,
        { isVerified: true },
        {
          leadDirectoryLeads: {
            some: {
              directoryId: { in: ["dir_a", "dir_b"] },
              directory: { ownerId },
            },
          },
        },
      ]),
    );
  });

  it("supports directoryIds including UNASSIGNED_DIRECTORY_ID (OR with unassigned)", () => {
    const where = buildLeadWhere({
      ownerId,
      filters: { directoryIds: ["dir_a", UNASSIGNED_DIRECTORY_ID] },
    });

    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(
      expect.arrayContaining([
        ownerVisibility,
        { isVerified: true },
        {
          OR: [
            {
              leadDirectoryLeads: {
                some: {
                  directoryId: { in: ["dir_a"] },
                  directory: { ownerId },
                },
              },
            },
            {
              leadDirectoryLeads: {
                none: { directory: { ownerId } },
              },
            },
          ],
        },
      ]),
    );
  });

  it("uses company-wide visibility when companyId is provided", () => {
    const where = buildLeadWhere({ ownerId, companyId });
    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(
      expect.arrayContaining([companyVisibility, { isVerified: true }]),
    );
  });

  it("uses owner-only visibility when companyId is not provided", () => {
    const where = buildLeadWhere({ ownerId });
    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(
      expect.arrayContaining([ownerVisibility]),
    );
    // Should NOT contain company visibility
    expect(andFilters).not.toEqual(
      expect.arrayContaining([companyVisibility]),
    );
  });

  it("expands directory filter to company members when companyId is provided", () => {
    const where = buildLeadWhere({
      ownerId,
      companyId,
      filters: { directoryIds: ["dir_a"] },
    });

    const andFilters = (where as { AND: unknown[] }).AND;
    expect(andFilters).toEqual(
      expect.arrayContaining([
        companyVisibility,
        {
          leadDirectoryLeads: {
            some: {
              directoryId: { in: ["dir_a"] },
              directory: {
                owner: {
                  OR: [{ id: ownerId }, { companyId }],
                },
              },
            },
          },
        },
      ]),
    );
  });
});
