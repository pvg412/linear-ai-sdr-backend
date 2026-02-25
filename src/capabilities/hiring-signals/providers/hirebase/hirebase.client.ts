import axios from "axios";

import type { HirebaseSearchRequest } from "./hirebase.dto";
import {
  HirebaseSearchResponseSchema,
  type HirebaseSearchResponseParsed,
} from "./hirebase.schemas";

const HIREBASE_BASE_URL = "https://api.hirebase.org";

/**
 * Thin HTTP client for the Hirebase API.
 *
 * Handles only transport concerns (headers, timeout, parsing).
 * Rate-limit enforcement and error wrapping live in the provider layer.
 */
export class HirebaseClient {
  constructor(private readonly apiKey: string) {}

  /**
   * POST /v2/jobs/search
   *
   * Returns a parsed, Zod-validated response.
   * Throws the raw axios error on non-2xx responses — callers must wrap.
   */
  async searchJobs(
    request: HirebaseSearchRequest,
  ): Promise<HirebaseSearchResponseParsed> {
    const res = await axios.post(
      `${HIREBASE_BASE_URL}/v2/jobs/search`,
      request,
      {
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        timeout: 30_000,
      },
    );

    return HirebaseSearchResponseSchema.parse(res.data);
  }
}
