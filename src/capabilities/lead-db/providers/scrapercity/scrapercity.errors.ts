import { UserFacingError } from "@/infra/userFacingError";
import { isAxiosError, formatAxiosErrorForLog } from "@/capabilities/lead-db/shared/axiosError";
import { SCRAPERCITY_ALLOWED_COMPANY_INDUSTRIES } from "./allowlists/scrapercity.allowedIndustries";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseScraperCityError(data: unknown): { type?: string; message?: string } | undefined {
  if (!isRecord(data)) return undefined;

  const err = data.error;
  if (!isRecord(err)) return undefined;

  const type = typeof err.type === "string" ? err.type : undefined;
  const message = typeof err.message === "string" ? err.message : undefined;

  return { type, message };
}

export function wrapScraperCityAxiosError(e: unknown): void {
  if (!isAxiosError(e)) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ScraperCityLeadDb] error", msg);
    return;
  }

  console.error("[ScraperCityLeadDb] error response", formatAxiosErrorForLog(e));

  const status = e.response?.status;
  const parsed = parseScraperCityError(e.response?.data);
  const providerMessage = parsed?.message;

  if (status === 400 && parsed?.type === "invalid-input") {
    const allowed = new Set<string>(SCRAPERCITY_ALLOWED_COMPANY_INDUSTRIES as readonly string[]);

    const examples = [
      "Computer Software",
      "Information Technology & Services",
      "Internet",
      "Computer & Network Security",
      "Financial Services",
      "Venture Capital & Private Equity",
    ].filter((x) => allowed.has(x));

    throw new UserFacingError({
      code: "SCRAPERCITY_INVALID_INPUT",
      userMessage:
        `ScraperCity rejected filters (invalid input).\n` +
        `Check industry/seniority/titles. Examples of allowed industry: ${examples.join(", ")}.\n`,
      debugMessage: providerMessage ? `ScraperCity invalid-input: ${providerMessage}` : undefined,
      details: { status, providerMessage },
    });
  }
}
