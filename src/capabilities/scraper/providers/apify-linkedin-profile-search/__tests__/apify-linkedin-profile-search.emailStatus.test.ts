import { describe, expect, test } from "vitest";

import { normalizeApifyEmailStatus } from "@/capabilities/shared/emailStatus";

describe("normalizeApifyEmailStatus()", () => {
  test("maps emails[].status=valid to DELIVERABLE", () => {
    const status = normalizeApifyEmailStatus({
      selectedEmail: "ugur.duman@horoz.com.tr",
      emails: [
        {
          email: "ugur.duman@horoz.com.tr",
          status: "valid",
          deliverable: true,
          catchAllDomain: false,
          validEmailServer: true,
          qualityScore: 90,
        },
      ],
    });
    expect(status).toBe("DELIVERABLE");
  });

  test("maps catchAllDomain=true to CATCH_ALL", () => {
    const status = normalizeApifyEmailStatus({
      selectedEmail: "a@b.com",
      emails: [{ email: "a@b.com", catchAllDomain: true }],
    });
    expect(status).toBe("CATCH_ALL");
  });

  test("maps deliverable=false to UNDELIVERABLE", () => {
    const status = normalizeApifyEmailStatus({
      selectedEmail: "a@b.com",
      emails: [{ email: "a@b.com", deliverable: false }],
    });
    expect(status).toBe("UNDELIVERABLE");
  });

  test("falls back to legacy email_result string mapping", () => {
    const status = normalizeApifyEmailStatus({
      selectedEmail: "a@b.com",
      legacyEmailResult: "catch_all",
    });
    expect(status).toBe("CATCH_ALL");
  });
});
