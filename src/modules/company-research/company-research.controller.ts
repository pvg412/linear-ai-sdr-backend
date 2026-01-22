import type { FastifyInstance } from "fastify";

import { container } from "@/container";
import { requireRequestUserId } from "@/infra/auth/requestUser";

import { COMPANY_RESEARCH_TYPES } from "./company-research.types";
import { CompanyResearchQueryService } from "./services/company-research.query.service";
import {
  CompanyResearchParamsSchema,
  CompanyResearchQuerySchema,
} from "./schemas/company-research.schemas";

export function registerCompanyResearchRoutes(app: FastifyInstance): void {
  const queryService = container.get<CompanyResearchQueryService>(
    COMPANY_RESEARCH_TYPES.CompanyResearchQueryService,
  );

  // GET /leads/:leadId/company-research - Get new research results
  app.get("/leads/:leadId/company-research", async (req) => {
    const userId = requireRequestUserId(req);

    const params = CompanyResearchParamsSchema.parse(req.params);
    const query = CompanyResearchQuerySchema.parse(req.query);

    return await queryService.getCompanyResearch(userId, params.leadId, query);
  });

  // GET /leads/:leadId/company-research/history - Get saved research history
  app.get("/leads/:leadId/company-research/history", async (req) => {
    const userId = requireRequestUserId(req);

    const params = CompanyResearchParamsSchema.parse(req.params);

    return await queryService.getCompanyResearchHistory(userId, params.leadId);
  });
}
