import axios, { AxiosError } from "axios";

export function isAxiosError(e: unknown): e is AxiosError {
  return axios.isAxiosError(e);
}

export function formatAxiosErrorForLog(e: AxiosError): {
  status?: number;
  data?: unknown;
  request: { method?: unknown; url?: unknown; params?: unknown; data?: unknown };
} {
  return {
    status: e.response?.status,
    data: e.response?.data,
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
