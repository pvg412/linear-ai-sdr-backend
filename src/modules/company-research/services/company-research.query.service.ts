import { injectable } from "inversify";

import { getPrisma } from "@/infra/prisma";
import { UserFacingError } from "@/infra/userFacingError";
import type {
  CompanyResearchResponse,
} from "../schemas/company-research.schemas";

@injectable()
export class CompanyResearchQueryService {
  constructor() { }

  async getCompanyResearchHistory(
    userId: string,
    leadId: string,
  ): Promise<CompanyResearchResponse[]> {
    const prisma = getPrisma();

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "User not found",
      });
    }

    // Fetch only the latest research for the lead
    const latestResearch = await prisma.companyResearch.findFirst({
      where: { leadId },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!latestResearch) {
      return [];
    }

    // Sort items by date (newest first, nulls last)
    const sortedItems = latestResearch.items
      .map((item) => ({
        date: item.date,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        category: item.category.toLowerCase() as
          | "news"
          | "blog"
          | "activity"
          | "website"
          | "linkedin_post",
      }))
      .sort((a, b) => {
        // Items without dates go to the end
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        // Sort by date descending (newest first)
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

    return [
      {
        leadId: latestResearch.leadId,
        company: latestResearch.company,
        companyDomain: latestResearch.companyDomain,
        searchedAt: latestResearch.searchedAt.toISOString(),
        items: sortedItems,
      },
    ];
  }
}
