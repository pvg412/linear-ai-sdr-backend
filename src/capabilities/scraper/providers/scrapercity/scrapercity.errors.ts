import { UserFacingError } from "@/infra/userFacingError";
import { isAxiosError, formatAxiosErrorForLog } from "@/capabilities/shared/axiosError";

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
    console.error("[ScraperCityScraper] error", msg);
    return;
  }

  console.error("[ScraperCityScraper] error response", formatAxiosErrorForLog(e));

  const status = e.response?.status;
  const parsed = parseScraperCityError(e.response?.data);
  const providerMessage = parsed?.message;

  if (status === 400 && parsed?.type === "invalid-input") {
    throw new UserFacingError({
      code: "SCRAPERCITY_INVALID_INPUT",
      userMessage:
        `ScraperCity rejected request (invalid input).\n` +
        `Check Apollo URL, limit and parameters.\n`,
      debugMessage: providerMessage ? `ScraperCity invalid-input: ${providerMessage}` : undefined,
      details: { status, providerMessage },
    });
  }
}
