import { describe, it, expect } from "vitest";

import {
  extractSlugFromDomain,
  normalizeCompanyName,
  splitCamelCase,
  generateCandidateSlugs,
} from "./normalize-company-name";

/* ------------------------------------------------------------------ */
/*  extractSlugFromDomain                                              */
/* ------------------------------------------------------------------ */

describe("extractSlugFromDomain", () => {
  it("extracts slug from a plain domain", () => {
    expect(extractSlugFromDomain("evacodes.com")).toBe("evacodes");
  });

  it("extracts slug from a .io domain", () => {
    expect(extractSlugFromDomain("gigradar.io")).toBe("gigradar");
  });

  it("handles https:// prefix", () => {
    expect(extractSlugFromDomain("https://example.com")).toBe("example");
  });

  it("handles www. prefix", () => {
    expect(extractSlugFromDomain("www.acme.co")).toBe("acme");
  });

  it("handles full URL with path", () => {
    expect(extractSlugFromDomain("https://www.openai.com/about")).toBe("openai");
  });

  it("handles domain with port and TLD", () => {
    expect(extractSlugFromDomain("example.com:3000")).toBe("example");
  });

  it("handles hyphenated domain", () => {
    expect(extractSlugFromDomain("gig-radar.io")).toBe("gig-radar");
  });

  it("returns null for null/undefined/empty", () => {
    expect(extractSlugFromDomain(null)).toBeNull();
    expect(extractSlugFromDomain(undefined)).toBeNull();
    expect(extractSlugFromDomain("")).toBeNull();
  });

  it("returns null for single-char slug", () => {
    expect(extractSlugFromDomain("x.com")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  normalizeCompanyName                                               */
/* ------------------------------------------------------------------ */

describe("normalizeCompanyName", () => {
  it("strips LLC suffix", () => {
    expect(normalizeCompanyName("GigRadar LLC")).toBe("gigradar");
  });

  it("strips Inc. suffix", () => {
    expect(normalizeCompanyName("Acme Corp Inc.")).toBe("acme-corp");
  });

  it("strips Ltd suffix", () => {
    expect(normalizeCompanyName("Barclays Ltd")).toBe("barclays");
  });

  it("strips GmbH suffix", () => {
    expect(normalizeCompanyName("Siemens GmbH")).toBe("siemens");
  });

  it("strips .io domain suffix from name", () => {
    expect(normalizeCompanyName("GigRadar.io")).toBe("gigradar");
  });

  it("strips .ai domain suffix from name", () => {
    expect(normalizeCompanyName("DeepMind.ai")).toBe("deepmind");
  });

  it("handles multi-word names", () => {
    expect(normalizeCompanyName("Palo Alto Networks")).toBe("palo-alto-networks");
  });

  it("handles names with dots and punctuation", () => {
    expect(normalizeCompanyName("U.S. Steel Corp.")).toBe("u-s-steel");
  });

  it("handles already-lowercase simple names", () => {
    expect(normalizeCompanyName("stripe")).toBe("stripe");
  });

  it("handles names with trailing spaces", () => {
    expect(normalizeCompanyName("  Notion  ")).toBe("notion");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("   ")).toBe("");
  });

  it("handles SAS suffix", () => {
    expect(normalizeCompanyName("Doctolib SAS")).toBe("doctolib");
  });

  it("handles combined domain + legal suffix", () => {
    expect(normalizeCompanyName("Vercel.co Inc")).toBe("vercel");
  });
});

/* ------------------------------------------------------------------ */
/*  splitCamelCase                                                     */
/* ------------------------------------------------------------------ */

describe("splitCamelCase", () => {
  it("splits PascalCase", () => {
    expect(splitCamelCase("GigRadar")).toEqual(["Gig", "Radar"]);
  });

  it("splits camelCase", () => {
    expect(splitCamelCase("openAI")).toEqual(["open", "AI"]);
  });

  it("handles all-uppercase acronym followed by word", () => {
    expect(splitCamelCase("ABCTech")).toEqual(["ABC", "Tech"]);
  });

  it("returns single word as-is", () => {
    expect(splitCamelCase("Stripe")).toEqual(["Stripe"]);
  });

  it("handles all-lowercase", () => {
    expect(splitCamelCase("notion")).toEqual(["notion"]);
  });
});

/* ------------------------------------------------------------------ */
/*  generateCandidateSlugs                                             */
/* ------------------------------------------------------------------ */

describe("generateCandidateSlugs", () => {
  it("prioritises domain-based slug first", () => {
    const slugs = generateCandidateSlugs({
      companyName: "GigRadar LLC",
      companyDomain: "gigradar.io",
    });
    expect(slugs[0]).toBe("gigradar");
  });

  it("includes normalised name as second priority", () => {
    const slugs = generateCandidateSlugs({
      companyName: "Acme Corp Inc.",
      companyDomain: "acme.com",
    });
    expect(slugs[0]).toBe("acme");
    expect(slugs).toContain("acme-corp");
  });

  it("generates camelCase split variations", () => {
    const slugs = generateCandidateSlugs({
      companyName: "GigRadar",
      companyDomain: null,
    });
    expect(slugs).toContain("gigradar");
    expect(slugs).toContain("gig-radar");
  });

  it("generates tech suffix variations", () => {
    const slugs = generateCandidateSlugs({
      companyName: "Notion",
      companyDomain: "notion.so",
    });
    expect(slugs).toContain("notion");
    expect(slugs).toContain("notion-io");
    expect(slugs).toContain("notion-ai");
  });

  it("deduplicates slugs", () => {
    const slugs = generateCandidateSlugs({
      companyName: "stripe",
      companyDomain: "stripe.com",
    });
    const unique = new Set(slugs);
    expect(slugs.length).toBe(unique.size);
  });

  it("handles no domain provided", () => {
    const slugs = generateCandidateSlugs({
      companyName: "OpenAI",
    });
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs).toContain("openai");
  });

  it("generates first-word slug for multi-word names", () => {
    const slugs = generateCandidateSlugs({
      companyName: "Palo Alto Networks Inc",
      companyDomain: "paloaltonetworks.com",
    });
    expect(slugs).toContain("paloaltonetworks");
    expect(slugs).toContain("palo-alto-networks");
    expect(slugs).toContain("palo");
  });

  it("handles .io company with matching domain", () => {
    const slugs = generateCandidateSlugs({
      companyName: "GigRadar.io",
      companyDomain: "gigradar.io",
    });
    expect(slugs[0]).toBe("gigradar");
    // Should have -io variation
    expect(slugs).toContain("gigradar-io");
  });

  it("handles empty company name gracefully", () => {
    const slugs = generateCandidateSlugs({
      companyName: "",
      companyDomain: "example.com",
    });
    // Domain slug should still work
    expect(slugs).toContain("example");
  });

  it("returns at least one slug for a reasonable company", () => {
    const slugs = generateCandidateSlugs({
      companyName: "Microsoft Corporation",
      companyDomain: "microsoft.com",
    });
    expect(slugs.length).toBeGreaterThanOrEqual(1);
    expect(slugs[0]).toBe("microsoft");
  });
});
