import { describe, expect, it } from "vitest";

import {
  normalizeCompanyName,
  matchesCompanyName,
  matchesDomain,
} from "./company-match.utils";

/* ------------------------------------------------------------------ */
/*  normalizeCompanyName                                                */
/* ------------------------------------------------------------------ */

describe("normalizeCompanyName", () => {
  it.each([
    ["Meta Platforms, Inc.", "Meta Platforms"],
    ["Acme Corp.", "Acme"],
    ["Acme Corp", "Acme"],
    ["OpenAI LLC", "OpenAI"],
    ["Tesla, Inc.", "Tesla"],
    ["SAP SE", "SAP SE"], // "SE" is not in the suffix list
    ["Siemens AG", "Siemens"],
    ["Deutsche Bank GmbH", "Deutsche Bank"],
    ["Stripe", "Stripe"], // No suffix — unchanged
    ["  Acme  Corp.  ", "Acme"],
    ["Some Company Pvt. Ltd.", "Some Company"],
    ["Some Company Pvt Ltd", "Some Company"],
    ["My Holdings", "My"], // "Holdings" is a suffix
    ["Holdings Inc.", "Holdings"], // "Inc." stripped, "Holdings" is the whole name
  ])("normalizes %j → %j", (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeCompanyName("   ")).toBe("");
  });

  it("handles trailing comma without suffix", () => {
    expect(normalizeCompanyName("Acme,")).toBe("Acme");
  });
});

/* ------------------------------------------------------------------ */
/*  matchesCompanyName                                                  */
/* ------------------------------------------------------------------ */

describe("matchesCompanyName", () => {
  it("matches whole-word company name", () => {
    const text = "we are excited to partner with acme on this project";
    expect(matchesCompanyName(text, "acme")).toBe(true);
  });

  it("does not match substring inside another word", () => {
    const text = "the new architecture is amazing";
    expect(matchesCompanyName(text, "arc")).toBe(false);
  });

  it("rejects names shorter than 3 characters", () => {
    const text = "this is about ai and machine learning";
    expect(matchesCompanyName(text, "ai")).toBe(false);
  });

  it("matches multi-word company names", () => {
    const text = "i just joined meta platforms and it is great";
    expect(matchesCompanyName(text, "meta platforms")).toBe(true);
  });

  it("matches at start of text", () => {
    const text = "stripe just launched a new api";
    expect(matchesCompanyName(text, "stripe")).toBe(true);
  });

  it("matches at end of text", () => {
    const text = "the best payment processor is stripe";
    expect(matchesCompanyName(text, "stripe")).toBe(true);
  });

  it("does not match partial word at boundary", () => {
    const text = "i love using striped socks";
    expect(matchesCompanyName(text, "stripe")).toBe(false);
  });

  it("handles regex-special characters in company name", () => {
    const text = "does anyone still use c++ for web?";
    expect(matchesCompanyName(text, "c++")).toBe(true);
  });

  it("handles parentheses in company name", () => {
    const text = "y combinator (yc) backed startup";
    expect(matchesCompanyName(text, "y combinator (yc)")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  matchesDomain                                                       */
/* ------------------------------------------------------------------ */

describe("matchesDomain", () => {
  it("matches domain in URL", () => {
    const text = "check out https://example.com/blog for more info";
    expect(matchesDomain(text, "example.com")).toBe(true);
  });

  it("matches domain in plain text", () => {
    const text = "their website is stripe.com and it is great";
    expect(matchesDomain(text, "stripe.com")).toBe(true);
  });

  it("returns false for null domain", () => {
    expect(matchesDomain("some text", null)).toBe(false);
  });

  it("returns false for undefined domain", () => {
    expect(matchesDomain("some text", undefined)).toBe(false);
  });

  it("returns false for very short domains", () => {
    expect(matchesDomain("some a.b text", "a.b")).toBe(false);
  });

  it("returns false when domain is not present", () => {
    const text = "nothing to see here about payments";
    expect(matchesDomain(text, "stripe.com")).toBe(false);
  });
});
