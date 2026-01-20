import { Client as MinioClient } from "minio";
import { gzip as gzipCb } from "node:zlib";
import { promisify } from "node:util";

import { loadEnv } from "@/config/env";

const gzip = promisify(gzipCb);

export type StoredRawRef = {
  bucket: string;
  objectKey: string;
  contentType: string;
  contentEncoding: string;
  sizeBytes: number;
  etag: string | null;
};

export interface LeadSearchRawStorage {
  putLeadRunRawBundle(input: {
    leadSearchId: string;
    runId: string;
    provider: string;
    items: Array<{
      leadId: string;
      providerExternalId: string | null;
      raw: unknown;
    }>;
  }): Promise<StoredRawRef | null>;
}

function parseEndpoint(input: string) {
  const s = input.trim();
  if (!s) return null;

  if (s.startsWith("http://") || s.startsWith("https://")) {
    const u = new URL(s);
    return {
      endPoint: u.hostname,
      port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
      useSSL: u.protocol === "https:",
    };
  }

  // host:port
  const m = s.match(/^([^:/]+):(\d+)$/);
  if (m) return { endPoint: m[1], port: Number(m[2]), useSSL: false };

  // host only
  return { endPoint: s, port: 9000, useSSL: false };
}

export class NoopLeadSearchRawStorage implements LeadSearchRawStorage {
  // eslint-disable-next-line @typescript-eslint/require-await
  async putLeadRunRawBundle(): Promise<StoredRawRef | null> {
    return null;
  }
}

export class MinioLeadSearchRawStorage implements LeadSearchRawStorage {
  private readonly client: MinioClient;
  private readonly bucket: string;
  private readonly region: string;
  private ensuredBucket: Promise<void> | null = null;

  constructor() {
    const env = loadEnv();

    const endpoint = env.MINIO_ENDPOINT?.trim() ?? "";
    const accessKey = env.MINIO_ACCESS_KEY?.trim() ?? "";
    const secretKey = env.MINIO_SECRET_KEY?.trim() ?? "";

    // Support URL-form endpoints first; fallback to env flags / defaults
    const parsed = parseEndpoint(endpoint);
    const endPoint = parsed?.endPoint ?? endpoint;
    const useSSL = parsed?.useSSL ?? false;
    const port =
      parsed?.port ??
      // If user provided a plain host (no URL), assume default MinIO port
      9000;

    if (!endPoint || !accessKey || !secretKey) {
      throw new Error(
        "MinIO is not configured (MINIO_ENDPOINT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY)",
      );
    }

    this.client = new MinioClient({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    this.bucket = (
      env.MINIO_BUCKET_LEAD_SEARCH_RAW ?? "lead-search-raw"
    ).trim();
    this.region = (env.MINIO_REGION ?? "us-east-1").trim();
  }

  async putLeadRunRawBundle(input: {
    leadSearchId: string;
    runId: string;
    provider: string;
    items: Array<{
      leadId: string;
      providerExternalId: string | null;
      raw: unknown;
    }>;
  }): Promise<StoredRawRef> {
    await this.ensureBucket();

    const json = JSON.stringify({
      _hint: "lead_search_run_raw_bundle",
      leadSearchId: input.leadSearchId,
      runId: input.runId,
      provider: input.provider,
      items: input.items,
    });
    const gz = await gzip(Buffer.from(json, "utf-8"));

    const objectKey = [
      "lead-search",
      "runs",
      input.leadSearchId,
      input.runId,
      `${input.provider}`,
      "raw-bundle.json.gz",
    ]
      .filter(Boolean)
      .join("/");

    const metaData: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
    };

    const res = await this.client.putObject(
      this.bucket,
      objectKey,
      gz,
      gz.length,
      metaData,
    );

    return {
      bucket: this.bucket,
      objectKey,
      contentType: "application/json",
      contentEncoding: "gzip",
      sizeBytes: gz.length,
      etag: typeof res?.etag === "string" ? res.etag : null,
    };
  }

  private async ensureBucket(): Promise<void> {
    if (this.ensuredBucket) return this.ensuredBucket;

    this.ensuredBucket = (async () => {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, this.region);
      }
    })();

    return this.ensuredBucket;
  }
}
