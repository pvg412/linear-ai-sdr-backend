import { UserFacingError } from "@/infra/userFacingError";
import {
  isAxiosError,
  formatAxiosErrorForLog,
  safeJson,
} from "@/capabilities/shared/axiosError";

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function wrapSearchLeadsAxiosError(e: unknown): void {
  if (!isAxiosError(e)) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[SearchLeadsLeadDb] error", msg);
    return;
  }

  console.error("[SearchLeadsLeadDb] error response", formatAxiosErrorForLog(e));

  const status = e.response?.status;
  const providerMessage = extractMessage(e.response?.data);

  if (status === 401) {
    throw new UserFacingError({
      code: "SEARCHLEADS_UNAUTHORIZED",
      userMessage: "SearchLeads: invalid API key (Unauthorized).",
      debugMessage: providerMessage,
      details: { status },
    });
  }

  if (status === 400 || status === 422) {
    throw new UserFacingError({
      code: "SEARCHLEADS_INVALID_INPUT",
      userMessage:
        "SearchLeads rejected filters (invalid request). Please adjust JSON and try again.",
      debugMessage: providerMessage,
      details: { status, providerMessage },
    });
  }
}

function extractMessage(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;

  const msg = data.message;
  if (typeof msg === "string" && msg.trim().length > 0) return msg;

  return safeJson(data);
}
