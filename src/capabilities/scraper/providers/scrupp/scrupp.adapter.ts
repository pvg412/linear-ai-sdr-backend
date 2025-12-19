import axios, { AxiosError } from "axios";
import { injectable } from "inversify";
import { LeadProvider } from "@prisma/client";

import { loadEnv } from "@/config/env";
import {
  ScrapeQuery,
  ScraperAdapter,
  ScraperAdapterResult,
} from "@/capabilities/scraper/scraper.dto";
import { ScruppApolloRow } from "./scrupp.dto";
import { NormalizedLead } from "@/capabilities/shared/leadValidate";

const env = loadEnv();

const SCRUPP_APOLLO_SEARCH_PATH = "/apollo/search";

const scruppAccount =
  env.SCRUPP_ACCOUNT_EMAIL && env.SCRUPP_ACCOUNT_COOKIE
    ? {
        email: env.SCRUPP_ACCOUNT_EMAIL,
        cookie: env.SCRUPP_ACCOUNT_COOKIE,
        type: env.SCRUPP_ACCOUNT_TYPE ?? "apollo",
        agent: env.SCRUPP_ACCOUNT_AGENT,
        premium: env.SCRUPP_ACCOUNT_PREMIUM,
      }
    : undefined;

@injectable()
export class ScruppApolloAdapter implements ScraperAdapter {
  public readonly provider = LeadProvider.SCRUPP;

  constructor(
    private readonly apiKey: string,
    private readonly enabled: boolean,
  ) {}

  isEnabled(): boolean {
    return this.enabled && !!this.apiKey;
  }

  async scrape(query: ScrapeQuery): Promise<ScraperAdapterResult> {
    if (!this.isEnabled()) {
      throw new Error("ScruppApolloAdapter is disabled or misconfigured");
    }

    try {
      const res = await axios.post<ScruppApolloRow[]>(
        `${env.SCRUPP_SCRAPER_API_URL}${SCRUPP_APOLLO_SEARCH_PATH}`,
        {
          url: query.apolloUrl,
          with_emails: true,
          account: scruppAccount,
          max: query.limit,
          page: 1,
        },
        {
          params: { api_key: this.apiKey },
          headers: { "Content-Type": "application/json" },
          timeout: 60_000,
        },
      );

      const rows = res.data;
      console.log("[Scrupp] rows length:", rows.length);

      const leads: NormalizedLead[] = rows.map((row) => ({
        source: LeadProvider.SCRUPP,

        externalId: row.id ?? undefined,

        fullName: row.full_name ?? undefined,
        firstName: row.first_name ?? undefined,
        lastName: row.last_name ?? undefined,
        title: row.title ?? row.headline ?? undefined,
        company: row.company ?? undefined,
        companyDomain: row.company_domain ?? undefined,
        companyUrl: row.company_website ?? undefined,
        linkedinUrl: row.linkedin_url ?? undefined,
        location: row.location ?? undefined,

        email: row.work_email ?? row.email ?? undefined,

        raw: row,
      }));

      return {
        provider: this.provider,
        providerRunId: undefined,
        fileNameHint: undefined,
        leads,
      };
    } catch (e) {
      if (e instanceof AxiosError) {
        console.error("[Scrupp] error response", {
          status: e.response?.status,
          data: e.response?.data as unknown,
          request: {
            method: e.config?.method,
            url: e.config?.url,
          },
        });
      } else {
        console.error("[Scrupp] error", (e as Error).message, {
          request: {
            url: query.apolloUrl,
          },
        });
      }
      throw e;
    }
  }
}
