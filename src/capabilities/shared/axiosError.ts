import axios, { AxiosError } from "axios";

export function isAxiosError(e: unknown): e is AxiosError {
  return axios.isAxiosError(e);
}

function truncateString(
  value: string,
  maxLen: number,
): { value: string; truncated: boolean } {
  if (value.length <= maxLen) return { value, truncated: false };
  return {
    value: `${value.slice(0, maxLen)}… (truncated, ${value.length} chars)`,
    truncated: true,
  };
}

export function formatAxiosErrorForLog(e: AxiosError): {
  status?: number;
  data?: unknown;
  request: {
    method?: unknown;
    url?: unknown;
    params?: unknown;
    data?: unknown;
  };
} {
  const data = e.response?.data;
  const safeData =
    typeof data === "string" ? truncateString(data, 2_000).value : data;

  return {
    status: e.response?.status,
    data: safeData,
    request: {
      method: e.config?.method,
      url: e.config?.url,
      params: e.config?.params,
      data: e.config?.data,
    },
  };
}

export function safeJson(data: unknown): string | undefined {
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}
