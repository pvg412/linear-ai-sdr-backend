import { injectable, inject } from "inversify";
import type { Redis } from "ioredis";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import { COMPANY_RESEARCH_TYPES } from "../company-research.types";
import { CompanyResearchRepository } from "../persistence/company-research.repository";
import { QUEUE_TYPES } from "@/infra/queue/queue.types";
import {
  createCompanyResearchQueue,
  companyResearchJobOptions,
  type CompanyResearchJobData,
} from "@/infra/queue/company-research/company-research.queue";
import type { CompanyResearchQuery } from "../schemas/company-research.schemas";
import { CompanyResearchStatus } from "@prisma/client";
import { BALANCE_TYPES } from "@/modules/balance/balance.types";
import type { BillingService } from "@/modules/balance/services/billing.service";
import { BILLING } from "@/config/billing.constants";

@injectable()
export class CompanyResearchCommandService {
  constructor(
    @inject(COMPANY_RESEARCH_TYPES.CompanyResearchRepository)
    private readonly repository: CompanyResearchRepository,
    @inject(QUEUE_TYPES.Redis)
    private readonly redis: Redis,
    @inject(BALANCE_TYPES.BillingService)
    private readonly billingService: BillingService,
  ) { }

  async requestCompanyResearch(
    userId: string,
    leadId: string,
    options: CompanyResearchQuery & { force?: boolean },
  ): Promise<{ companyResearchId: string; status: string; message: string }> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    // Fetch lead with company websites
    const lead = await this.repository.findLeadById(leadId);

    if (!lead) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Lead not found",
      });
    }

    // Require company name for search
    if (!lead.company) {
      throw new UserFacingError({
        code: "VALIDATION_ERROR",
        userMessage: "Lead does not have company information",
      });
    }

    // Check for existing pending research
    const existingRequest = await this.repository.findPendingResearchForLead(leadId);

    if (existingRequest && !options.force) {
      throw new UserFacingError({
        code: "CONFLICT",
        userMessage:
          "There is already a pending research request for this lead.",
      });
    }

    // Cancel existing request if force=true
    if (existingRequest && options.force) {
      await this.repository.cancelPendingResearch(existingRequest.id);
    }

    // Collect all company domains/websites
    const companyDomains: string[] = [];
    if (lead.companyUrl) companyDomains.push(lead.companyUrl);
    if (lead.companyLinkedinUrl) companyDomains.push(lead.companyLinkedinUrl);
    for (const website of lead.companyWebsites) {
      companyDomains.push(website.url);
    }

    // Billing — pre-check BEFORE creating DB record to avoid orphaned records.
    // Worst-case estimate: flat research fee + max possible LinkedIn post charges.
    const willFetchLinkedinPosts = options.includeLinkedinPosts && !!lead.companyLinkedinUrl;
    const worstCaseCents =
      BILLING.COMPANY_RESEARCH_CENTS +
      (willFetchLinkedinPosts ? options.maxResults * BILLING.LINKEDIN_POSTS_PER_POST_CENTS : 0);
    await this.billingService.ensureSufficientBalance(userId, worstCaseCents);

    // Create research record
    const research = await this.repository.createCompanyResearch({
      leadId: lead.id,
      requestedById: userId,
      company: lead.company,
      companyDomain: lead.companyDomain,
      recency: options.recency ?? null,
      maxResults: options.maxResults,
    });

    // Charge the flat research fee immediately before enqueuing.
    await this.billingService.chargeForCompanyResearch(userId);

    // Queue the job
    const queue = createCompanyResearchQueue(this.redis);
    const jobData: CompanyResearchJobData = {
      companyResearchId: research.id,
      leadId: lead.id,
      company: lead.company,
      companyDomains,
      companyLinkedinUrl: lead.companyLinkedinUrl,
      includeLinkedinPosts: options.includeLinkedinPosts,
      recency: options.recency ?? "month",
      maxResults: options.maxResults,
      triggeredById: userId,
    };

    await queue.add("companyResearch.run", jobData, companyResearchJobOptions());

    return {
      companyResearchId: research.id,
      status: CompanyResearchStatus.PENDING,
      message: "Company research job queued",
    };
  }

  async getResearchStatus(
    userId: string,
    leadId: string,
    researchId: string,
  ): Promise<{
    id: string;
    status: string;
    errorMessage: string | null;
    itemsCount: number;
  }> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    const research = await this.repository.findCompanyResearchById(researchId);

    if (!research) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Research not found",
      });
    }

    if (research.leadId !== leadId) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Research not found for this lead",
      });
    }

    return {
      id: research.id,
      status: research.status,
      errorMessage: research.errorMessage,
      itemsCount: research.items.length,
    };
  }
}
