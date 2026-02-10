import { describe, it, expect } from "vitest";
import { mapColumns, LEAD_FIELD_MAPPINGS } from "../column-mapping";

describe("mapColumns", () => {
  it("maps exact prisma field names", () => {
    const headers = ["firstName", "lastName", "linkedinUrl", "company", "email"];
    const result = mapColumns(headers);

    expect(result.missingRequired).toEqual([]);
    expect(result.matched).toHaveLength(5);
    expect(result.unmatchedCsvColumns).toEqual([]);

    const fields = result.matched.map((m) => m.prismaField);
    expect(fields).toContain("firstName");
    expect(fields).toContain("lastName");
    expect(fields).toContain("linkedinUrl");
    expect(fields).toContain("company");
    expect(fields).toContain("email");
  });

  it("maps common CSV aliases (snake_case, spaces, alternative names)", () => {
    const headers = [
      "First Name",
      "Last Name",
      "LinkedIn URL",
      "Company Name",
      "E-mail",
      "Phone Number",
      "Job Title",
    ];
    const result = mapColumns(headers);

    expect(result.missingRequired).toEqual([]);

    const fieldMap = Object.fromEntries(
      result.matched.map((m) => [m.prismaField, m.csvColumn]),
    );
    expect(fieldMap.firstName).toBe("First Name");
    expect(fieldMap.lastName).toBe("Last Name");
    expect(fieldMap.linkedinUrl).toBe("LinkedIn URL");
    expect(fieldMap.company).toBe("Company Name");
    expect(fieldMap.email).toBe("E-mail");
    expect(fieldMap.mobileNumber).toBe("Phone Number");
    expect(fieldMap.title).toBe("Job Title");
  });

  it("maps underscore-based aliases", () => {
    const headers = ["first_name", "last_name", "linkedin_url", "company_name"];
    const result = mapColumns(headers);

    expect(result.missingRequired).toEqual([]);
    expect(result.matched).toHaveLength(4);
  });

  it("maps alternative name aliases (organisation, employer)", () => {
    const headers = [
      "Given Name",
      "Surname",
      "LinkedIn Profile",
      "Organisation",
    ];
    const result = mapColumns(headers);

    expect(result.missingRequired).toEqual([]);
    const fieldMap = Object.fromEntries(
      result.matched.map((m) => [m.prismaField, m.csvColumn]),
    );
    expect(fieldMap.firstName).toBe("Given Name");
    expect(fieldMap.lastName).toBe("Surname");
    expect(fieldMap.linkedinUrl).toBe("LinkedIn Profile");
    expect(fieldMap.company).toBe("Organisation");
  });

  it("is case-insensitive", () => {
    const headers = ["FIRST NAME", "last NAME", "LINKEDIN url", "COMPANY"];
    const result = mapColumns(headers);

    expect(result.missingRequired).toEqual([]);
    expect(result.matched).toHaveLength(4);
  });

  it("reports missing required columns", () => {
    const headers = ["firstName", "lastName", "email"];
    const result = mapColumns(headers);

    expect(result.missingRequired).toContain("linkedinUrl");
    expect(result.missingRequired).toContain("company");
    expect(result.missingRequired).not.toContain("firstName");
    expect(result.missingRequired).not.toContain("lastName");
  });

  it("reports unmatched CSV columns", () => {
    const headers = [
      "firstName",
      "lastName",
      "linkedinUrl",
      "company",
      "Notes",
      "Custom Field",
      "Tags",
    ];
    const result = mapColumns(headers);

    expect(result.unmatchedCsvColumns).toEqual([
      "Notes",
      "Custom Field",
      "Tags",
    ]);
  });

  it("does not duplicate mappings when CSV has two columns matching the same field", () => {
    const headers = [
      "firstName",
      "First Name",
      "lastName",
      "linkedinUrl",
      "company",
    ];
    const result = mapColumns(headers);

    const firstNameMatches = result.matched.filter(
      (m) => m.prismaField === "firstName",
    );
    expect(firstNameMatches).toHaveLength(1);
    // First match wins
    expect(firstNameMatches[0].csvColumn).toBe("firstName");
    // Second one goes to unmatched
    expect(result.unmatchedCsvColumns).toContain("First Name");
  });

  it("handles empty headers array", () => {
    const result = mapColumns([]);

    expect(result.matched).toEqual([]);
    expect(result.unmatchedCsvColumns).toEqual([]);
    expect(result.missingRequired.length).toBeGreaterThan(0);
  });

  it("maps all supported optional fields", () => {
    const headers = [
      "firstName",
      "lastName",
      "linkedinUrl",
      "company",
      "email",
      "companyDomain",
      "title",
      "headline",
      "location",
      "mobileNumber",
      "companyUrl",
      "companyLinkedinUrl",
      "companySize",
      "companyIndustry",
      "companyLocation",
      "currentPosition",
      "seniorityLevel",
      "department",
      "yearsInPosition",
      "yearsInCompany",
      "totalExperienceYears",
      "fullName",
    ];
    const result = mapColumns(headers);

    expect(result.missingRequired).toEqual([]);
    expect(result.unmatchedCsvColumns).toEqual([]);
    expect(result.matched).toHaveLength(22);
  });

  it("assigns transform functions for enum and numeric fields", () => {
    const headers = [
      "firstName",
      "lastName",
      "linkedinUrl",
      "company",
      "companySize",
      "seniorityLevel",
      "yearsInPosition",
    ];
    const result = mapColumns(headers);

    const sizeMatch = result.matched.find(
      (m) => m.prismaField === "companySize",
    );
    expect(sizeMatch?.transform).toBeDefined();

    const seniorityMatch = result.matched.find(
      (m) => m.prismaField === "seniorityLevel",
    );
    expect(seniorityMatch?.transform).toBeDefined();

    const yearsMatch = result.matched.find(
      (m) => m.prismaField === "yearsInPosition",
    );
    expect(yearsMatch?.transform).toBeDefined();

    // String fields should not have transforms
    const firstNameMatch = result.matched.find(
      (m) => m.prismaField === "firstName",
    );
    expect(firstNameMatch?.transform).toBeUndefined();
  });
});

describe("LEAD_FIELD_MAPPINGS integrity", () => {
  it("has exactly 4 required fields", () => {
    const required = LEAD_FIELD_MAPPINGS.filter((m) => m.required);
    expect(required.map((m) => m.prismaField).sort()).toEqual([
      "company",
      "firstName",
      "lastName",
      "linkedinUrl",
    ]);
  });

  it("has no duplicate aliases across different fields", () => {
    const aliasToField = new Map<string, string>();
    const duplicates: string[] = [];

    for (const mapping of LEAD_FIELD_MAPPINGS) {
      for (const alias of mapping.aliases) {
        const existing = aliasToField.get(alias);
        if (existing && existing !== mapping.prismaField) {
          duplicates.push(
            `"${alias}" is used by both "${existing}" and "${mapping.prismaField}"`,
          );
        }
        aliasToField.set(alias, mapping.prismaField);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("has no duplicate prismaField names", () => {
    const fields = LEAD_FIELD_MAPPINGS.map((m) => m.prismaField);
    const unique = new Set(fields);
    expect(fields.length).toBe(unique.size);
  });
});

describe("transform functions via mapColumns", () => {
  function getTransform(prismaField: string) {
    const headers = [prismaField];
    const result = mapColumns(headers);
    return result.matched.find((m) => m.prismaField === prismaField)
      ?.transform;
  }

  describe("companySize transform", () => {
    const transform = getTransform("companySize")!;

    it("maps numeric strings to CompanySize enum", () => {
      expect(transform("1")).toBe("SELF_EMPLOYED");
      expect(transform("5")).toBe("STARTUP_1_10");
      expect(transform("25")).toBe("SMALL_11_50");
      expect(transform("100")).toBe("MEDIUM_51_200");
      expect(transform("300")).toBe("LARGE_201_500");
      expect(transform("800")).toBe("ENTERPRISE_501_1000");
      expect(transform("3000")).toBe("CORPORATE_1001_5000");
      expect(transform("7000")).toBe("MEGA_5001_10000");
      expect(transform("15000")).toBe("GIANT_10000_PLUS");
    });

    it("maps exact enum values", () => {
      expect(transform("SELF_EMPLOYED")).toBe("SELF_EMPLOYED");
      expect(transform("STARTUP_1_10")).toBe("STARTUP_1_10");
    });

    it("returns null for non-parseable values", () => {
      expect(transform("abc")).toBeNull();
      expect(transform("")).toBeNull();
    });
  });

  describe("seniorityLevel transform", () => {
    const transform = getTransform("seniorityLevel")!;

    it("maps common seniority labels", () => {
      expect(transform("Intern")).toBe("INTERN");
      expect(transform("Entry Level")).toBe("ENTRY_LEVEL");
      expect(transform("Junior")).toBe("JUNIOR");
      expect(transform("Mid Level")).toBe("MID_LEVEL");
      expect(transform("Senior")).toBe("SENIOR");
      expect(transform("Lead")).toBe("LEAD");
      expect(transform("Manager")).toBe("MANAGER");
      expect(transform("Director")).toBe("DIRECTOR");
      expect(transform("VP")).toBe("VP");
      expect(transform("C-Level")).toBe("C_LEVEL");
      expect(transform("Founder")).toBe("FOUNDER");
      expect(transform("Owner")).toBe("OWNER");
    });

    it("maps exact enum values (case insensitive)", () => {
      expect(transform("SENIOR")).toBe("SENIOR");
      expect(transform("MID_LEVEL")).toBe("MID_LEVEL");
      expect(transform("C_LEVEL")).toBe("C_LEVEL");
    });

    it("returns null for unknown values", () => {
      expect(transform("something random")).toBeNull();
    });
  });

  describe("yearsInPosition transform", () => {
    const transform = getTransform("yearsInPosition")!;

    it("parses valid integers", () => {
      expect(transform("5")).toBe(5);
      expect(transform("0")).toBe(0);
      expect(transform("10")).toBe(10);
    });

    it("returns null for invalid values", () => {
      expect(transform("abc")).toBeNull();
      expect(transform("-1")).toBeNull();
      expect(transform("")).toBeNull();
    });
  });
});
