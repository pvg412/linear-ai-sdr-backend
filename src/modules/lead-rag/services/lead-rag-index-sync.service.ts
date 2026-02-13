import { injectable } from "inversify";
import type { Queue } from "bullmq";

import { ensureLogger, type LoggerLike } from "@/infra/observability";
import { leadRagIndexJobOptions } from "@/infra/queue/lead-rag/lead-rag-index.queue";
import type {
  LeadRagIndexJobData,
  LeadRagIndexJobName,
} from "@/infra/queue/lead-rag/lead-rag-index.queue";

import { LeadRagIndexProcessorService } from "./lead-rag-index-processor.service";

function isJobAlreadyExistsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes("already exists");
}

@injectable()
export class LeadRagIndexSyncService {
  private readonly processor: LeadRagIndexProcessorService;
  private readonly leadRagIndexQueue?: Queue<
    LeadRagIndexJobData,
    void,
    LeadRagIndexJobName
  >;

  constructor(
    args: {
      processor: LeadRagIndexProcessorService;
      queue?: Queue<LeadRagIndexJobData, void, LeadRagIndexJobName>;
    },
  ) {
    this.processor = args.processor;
    this.leadRagIndexQueue = args.queue;
  }

  private upsertJobId(ownerId: string, leadId: string): string {
    return `rag-upsert-${ownerId}-${leadId}`;
  }
  private deleteJobId(ownerId: string, leadId: string): string {
    return `rag-delete-${ownerId}-${leadId}`;
  }

  /**
   * Enqueue upsert. If Redis isn't configured -> run inline (dev-friendly).
   */
  async enqueueUpsertLead(
    ownerId: string,
    leadId: string,
    opts?: { reason?: string; log?: LoggerLike },
  ): Promise<void> {
    const lg = ensureLogger(opts?.log);

    if (!this.leadRagIndexQueue) {
      lg.warn(
        { ownerId, leadId },
        "RAG queue is not configured; running inline upsert",
      );
      await this.processor.upsertLeadNow({ ownerId, leadId, log: lg });
      return;
    }

    const data: LeadRagIndexJobData = {
      ownerId,
      leadId,
      reason: opts?.reason ?? null,
      requestedAtMs: Date.now(),
    };

    try {
      await this.leadRagIndexQueue.add("leadRag.upsertLead", data, {
        ...leadRagIndexJobOptions(),
        jobId: this.upsertJobId(ownerId, leadId), // dedupe
      });
    } catch (e) {
      // Dedup is expected under bursts: ignore.
      if (isJobAlreadyExistsError(e)) return;
      throw e;
    }
  }

  /**
   * Enqueue delete. If Redis isn't configured -> run inline.
   */
  async enqueueDeleteLead(
    ownerId: string,
    leadId: string,
    opts?: { reason?: string; log?: LoggerLike },
  ): Promise<void> {
    const lg = ensureLogger(opts?.log);

    if (!this.leadRagIndexQueue) {
      lg.warn(
        { ownerId, leadId },
        "RAG queue is not configured; running inline delete",
      );
      await this.processor.deleteLeadNow({ ownerId, leadId, log: lg });
      return;
    }

    const data: LeadRagIndexJobData = {
      ownerId,
      leadId,
      reason: opts?.reason ?? null,
      requestedAtMs: Date.now(),
    };

    try {
      await this.leadRagIndexQueue.add("leadRag.deleteLead", data, {
        ...leadRagIndexJobOptions(),
        jobId: this.deleteJobId(ownerId, leadId), // dedupe
      });
    } catch (e) {
      if (isJobAlreadyExistsError(e)) return;
      throw e;
    }
  }

  /**
   * Convenience method for directory delete / bulk membership changes.
   */
  async enqueueUpsertLeads(
    ownerId: string,
    leadIds: string[],
    opts?: { reason?: string; log?: LoggerLike },
  ): Promise<void> {
    for (const leadId of Array.from(new Set(leadIds)).filter(Boolean)) {
      await this.enqueueUpsertLead(ownerId, leadId, opts);
    }
  }
}
