import { ApifyClient } from "apify-client";

import {
  ApifyActorRunSchema,
  ApifyLinkedinProfileRowSchema,
  type ApifyActorRun,
  type ApifyLinkedinProfileRow,
} from "./apify-linkedin-profile-search.schemas";

const DEFAULT_ACTOR_ID = "harvestapi/linkedin-profile-search";
const DATASET_PAGE_LIMIT = 1000;

export type ApifyLinkedinProfileSearchInput = {
  profileScraperMode?: string;
  searchQuery?: string;
  maxItems?: number;

  locations?: string[];
  currentCompanies?: string[];
  pastCompanies?: string[];
  schools?: string[];
  currentJobTitles?: string[];
  pastJobTitles?: string[];
  yearsOfExperienceIds?: string[];
  yearsAtCurrentCompanyIds?: string[];
  seniorityLevelIds?: string[];
  functionIds?: string[];
  industryIds?: string[];
  companyHeadcount?: string[];
  firstNames?: string[];
  lastNames?: string[];
  profileLanguages?: string[];
  recentlyChangedJobs?: boolean;

  excludeLocations?: string[];
  excludeCurrentCompanies?: string[];
  excludePastCompanies?: string[];
  excludeSchools?: string[];
  excludeCurrentJobTitles?: string[];
  excludePastJobTitles?: string[];
  excludeIndustryIds?: string[];
  excludeSeniorityLevelIds?: string[];
  excludeFunctionIds?: string[];

  startPage?: number;
  takePages?: number;

  autoQuerySegmentation?: boolean;
  autoQuerySegmentationLevels?: string[];
  autoQuerySegmentationTargetCountries?: string[];

  // dedup across runs via MongoDB (actor input)
  profileDeduplicationMode?:
  | "off"
  | "insert_ids"
  | "insert_profiles"
  | "read_only";
  mongoDbConnectionString?: string;

  // post-filtering (actor input)
  postFilteringMongoDbQuery?: Record<string, unknown>;
  postFilteringMongoDbAggregation?: Record<string, unknown>[];
};

export class ApifyLinkedinProfileSearchClient {
  private readonly client: ApifyClient;

  constructor(
    token: string,
    private readonly actorId: string = DEFAULT_ACTOR_ID,
  ) {
    this.client = new ApifyClient({ token });
  }

  async start(input: ApifyLinkedinProfileSearchInput): Promise<ApifyActorRun> {
    const run = await this.client.actor(this.actorId).start(input);
    return ApifyActorRunSchema.parse(run);
  }

  async getRun(runId: string): Promise<ApifyActorRun> {
    const run = await this.client.run(runId).get();
    if (!run) {
      throw new Error(`Apify run not found: ${runId}`);
    }
    return ApifyActorRunSchema.parse(run);
  }

  async listDatasetItems(
    datasetId: string,
    limit: number,
  ): Promise<ApifyLinkedinProfileRow[]> {
    const out: ApifyLinkedinProfileRow[] = [];
    let offset = 0;
    const target = Math.max(1, Math.floor(limit));

    while (out.length < target) {
      const remaining = target - out.length;
      const batchLimit = Math.min(remaining, DATASET_PAGE_LIMIT);

      const res = await this.client.dataset(datasetId).listItems({
        limit: batchLimit,
        offset,
        clean: false,
      });

      if (!res || !Array.isArray(res.items) || res.items.length === 0) break;

      const rows = ApifyLinkedinProfileRowSchema.array().parse(res.items);
      out.push(...rows);

      offset += rows.length;
      if (rows.length < batchLimit) break;
    }

    return out;
  }

  async getDatasetItemCount(datasetId: string): Promise<number> {
    const ds: unknown = await this.client.dataset(datasetId).get();
    if (!ds || typeof ds !== "object") return 0;

    const itemCount = (ds as Record<string, unknown>)["itemCount"];
    if (typeof itemCount === "number" && Number.isFinite(itemCount)) {
      return Math.max(0, Math.floor(itemCount));
    }
    return 0;
  }

  async getDatasetLastItem(
    datasetId: string,
  ): Promise<ApifyLinkedinProfileRow | null> {
    const total = await this.getDatasetItemCount(datasetId);
    if (total <= 0) return null;

    const res: unknown = await this.client.dataset(datasetId).listItems({
      limit: 1,
      offset: Math.max(0, total - 1),
      clean: false,
    });

    if (!res || typeof res !== "object") return null;
    const items = (res as Record<string, unknown>)["items"];
    if (!Array.isArray(items) || items.length === 0) return null;

    return ApifyLinkedinProfileRowSchema.parse(items[0]);
  }
}
