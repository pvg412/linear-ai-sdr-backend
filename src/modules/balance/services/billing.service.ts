import { inject, injectable } from "inversify";

import { UserFacingError } from "@/infra/userFacingError";
import { BILLING, centsToBillingDollars } from "@/config/billing.constants";
import { BALANCE_TYPES } from "../balance.types";
import type { BalanceCommandService } from "./balance.command.service";
import type { BalanceRepository } from "../persistence/balance.repository";
import type { LoggerLike } from "@/infra/observability";

export type PromptParseKind = "lead-search" | "outreach";

/**
 * BillingService — high-level billing operations wired to the balance system.
 *
 * All public methods are atomic: they call BalanceCommandService.adjustBalance()
 * which does a SELECT FOR UPDATE + single transaction write + audit log entry.
 *
 * Pre-checks (ensureSufficientBalance) are advisory — the real guard is the
 * negative-balance check inside the repository transaction. Pre-checks exist
 * to return a clear HTTP 402 before expensive external calls are made.
 */
@injectable()
export class BillingService {
  constructor(
    @inject(BALANCE_TYPES.BalanceCommandService)
    private readonly balanceCommandService: BalanceCommandService,

    @inject(BALANCE_TYPES.BalanceRepository)
    private readonly balanceRepository: BalanceRepository,
  ) {}

  // ── Pre-flight helpers ────────────────────────────────────────────────────

  /**
   * Reads the current balance and throws HTTP 402 if it is below the required
   * amount. This is a non-atomic advisory check — the real protection is the
   * DB constraint inside adjustBalance(). Call this BEFORE expensive external
   * operations to surface the error early.
   */
  async ensureSufficientBalance(userId: string, requiredCents: number): Promise<void> {
    const { balanceCents } = await this.balanceRepository.getUserBalance(userId);

    if (balanceCents < requiredCents) {
      throw new UserFacingError({
        code: "PAYMENT_REQUIRED",
        userMessage: `Insufficient balance. This operation costs ${centsToBillingDollars(requiredCents)} but your balance is ${centsToBillingDollars(balanceCents)}.`,
        details: {
          balanceCents,
          requiredCents,
        },
      });
    }
  }

  // ── Charge methods ────────────────────────────────────────────────────────

  /**
   * Flat $100 charge for a full pipeline run.
   * Call AFTER concurrency checks, BEFORE creating the PipelineRun record.
   */
  async chargeForPipeline(userId: string): Promise<void> {
    await this.balanceCommandService.adjustBalance({
      userId,
      amountCents: -BILLING.PIPELINE_RUN_CENTS,
      reason: `Pipeline run — ${centsToBillingDollars(BILLING.PIPELINE_RUN_CENTS)}`,
      performedById: userId,
    });
  }

  /**
   * Compensating refund for a failed pipeline start.
   * Credits back PIPELINE_RUN_CENTS when `createRun` or `queue.add` throws
   * after the charge has already been deducted. Call in the catch block only.
   * Failures are swallowed so the original error is not masked.
   */
  async refundPipelineCharge(userId: string): Promise<void> {
    await this.balanceCommandService.adjustBalance({
      userId,
      amountCents: BILLING.PIPELINE_RUN_CENTS, // positive = credit back
      reason: `Pipeline charge refund (start failed) — ${centsToBillingDollars(BILLING.PIPELINE_RUN_CENTS)}`,
      performedById: userId,
    });
  }

  /**
   * $0.01 charge for a single AI prompt parse (lead-search or outreach).
   * Call AFTER a successful gRPC parsePrompt / parseOutreachContext call.
   */
  async chargeForPromptParse(userId: string, kind: PromptParseKind): Promise<void> {
    const label = kind === "lead-search" ? "lead-search prompt parse" : "outreach prompt parse";

    await this.balanceCommandService.adjustBalance({
      userId,
      amountCents: -BILLING.PROMPT_PARSE_CENTS,
      reason: `AI ${label} — ${centsToBillingDollars(BILLING.PROMPT_PARSE_CENTS)}`,
      performedById: userId,
    });
  }

  /**
   * $0.01 charge for a single AI chat stream call (assistant reply, outreach
   * generation, or outreach continue per lead).
   * Call BEFORE the gRPC chatStream call (pre-checked + charged together).
   */
  async chargeForAiStream(userId: string): Promise<void> {
    await this.balanceCommandService.adjustBalance({
      userId,
      amountCents: -BILLING.AI_CHAT_STREAM_CENTS,
      reason: `AI chat stream — ${centsToBillingDollars(BILLING.AI_CHAT_STREAM_CENTS)}`,
      performedById: userId,
    });
  }

  /**
   * $0.05 charge for a standalone company research request (Perplexity Sonar Pro).
   * NOT charged when triggered inside the pipeline (covered by the flat fee).
   * Call BEFORE enqueuing the BullMQ job.
   */
  async chargeForCompanyResearch(userId: string): Promise<void> {
    await this.balanceCommandService.adjustBalance({
      userId,
      amountCents: -BILLING.COMPANY_RESEARCH_CENTS,
      reason: `Company research — ${centsToBillingDollars(BILLING.COMPANY_RESEARCH_CENTS)}`,
      performedById: userId,
    });
  }

  /**
   * $0.02 charge for a standalone profile enrichment request (Apify LinkedIn scraper).
   * NOT charged when triggered inside the pipeline (covered by the flat fee).
   * Call BEFORE enqueuing the BullMQ job.
   */
  async chargeForProfileEnrichment(userId: string): Promise<void> {
    await this.balanceCommandService.adjustBalance({
      userId,
      amountCents: -BILLING.PROFILE_ENRICHMENT_CENTS,
      reason: `Profile enrichment — ${centsToBillingDollars(BILLING.PROFILE_ENRICHMENT_CENTS)}`,
      performedById: userId,
    });
  }

  /**
   * Per-post charge for LinkedIn company posts fetched via Apify ($0.01/post).
   * Call AFTER the Apify fetch — only charge for posts actually returned.
   * Billing failures are logged but do NOT propagate (data already fetched).
   *
   * @param userId     The user who triggered the company research job.
   * @param postsCount Number of LinkedIn posts successfully fetched.
   * @param log        Optional logger for error reporting.
   */
  async chargeForLinkedinPosts(
    userId: string,
    postsCount: number,
    log?: LoggerLike,
  ): Promise<void> {
    if (postsCount <= 0) return;

    const amountCents = postsCount * BILLING.LINKEDIN_POSTS_PER_POST_CENTS;

    try {
      await this.balanceCommandService.adjustBalance({
        userId,
        amountCents: -amountCents,
        reason: `LinkedIn posts — ${postsCount} posts × ${centsToBillingDollars(BILLING.LINKEDIN_POSTS_PER_POST_CENTS)} = ${centsToBillingDollars(amountCents)}`,
        performedById: userId,
      });
    } catch (err) {
      // Posts are already fetched (Apify cost incurred) — do not crash. Log and continue.
      const msg = err instanceof Error ? err.message : String(err);
      if (log?.error) {
        log.error(
          { userId, postsCount, amountCents, err: msg },
          "BillingService: failed to charge for LinkedIn posts (data already fetched)",
        );
      } else {
        console.error(
          `BillingService: failed to charge for LinkedIn posts (userId=${userId}, postsCount=${postsCount}):`,
          msg,
        );
      }
    }
  }

  /**
   * Per-lead charge for chat-initiated lead generation ($0.05/lead).
   * Call AFTER markDone() — leads are already persisted.
   * Billing failures are logged but do NOT propagate (leads already saved).
   *
   * @param userId      The user who triggered the lead search.
   * @param totalLeads  Number of leads successfully persisted.
   * @param log         Optional logger for error reporting.
   */
  async chargeForLeadGeneration(
    userId: string,
    totalLeads: number,
    log?: LoggerLike,
  ): Promise<void> {
    if (totalLeads <= 0) return;

    const amountCents = totalLeads * BILLING.LEAD_GENERATION_PER_LEAD_CENTS;

    try {
      await this.balanceCommandService.adjustBalance({
        userId,
        amountCents: -amountCents,
        reason: `Lead generation — ${totalLeads} leads × ${centsToBillingDollars(BILLING.LEAD_GENERATION_PER_LEAD_CENTS)} = ${centsToBillingDollars(amountCents)}`,
        performedById: userId,
      });
    } catch (err) {
      // Leads are already persisted — do not undo them. Log and continue.
      const msg = err instanceof Error ? err.message : String(err);
      if (log?.error) {
        log.error(
          { userId, totalLeads, amountCents, err: msg },
          "BillingService: failed to charge for lead generation (leads already persisted)",
        );
      } else {
        console.error(
          `BillingService: failed to charge for lead generation (userId=${userId}, totalLeads=${totalLeads}):`,
          msg,
        );
      }
    }
  }
}
