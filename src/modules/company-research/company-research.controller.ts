import type { FastifyInstance, FastifyReply } from "fastify";

import { container } from "@/container";
import { requireRequestUserId } from "@/infra/auth/requestUser";

import { COMPANY_RESEARCH_TYPES } from "./company-research.types";
import { CompanyResearchQueryService } from "./services/company-research.query.service";
import { CompanyResearchCommandService } from "./services/company-research.command.service";
import {
  CompanyResearchParamsSchema,
  CompanyResearchQuerySchema,
  CompanyResearchStatusParamsSchema,
  RequestCompanyResearchBodySchema,
} from "./schemas/company-research.schemas";

export function registerCompanyResearchRoutes(app: FastifyInstance): void {
  const queryService = container.get<CompanyResearchQueryService>(
    COMPANY_RESEARCH_TYPES.CompanyResearchQueryService,
  );
  const commandService = container.get<CompanyResearchCommandService>(
    COMPANY_RESEARCH_TYPES.CompanyResearchCommandService,
  );

  // POST /leads/:leadId/company-research - Request new company research (async)
  app.post(
    "/leads/:leadId/company-research",
    async (req, reply: FastifyReply) => {
      const userId = requireRequestUserId(req);

      const params = CompanyResearchParamsSchema.parse(req.params);
      const query = CompanyResearchQuerySchema.parse(req.query);
      const body = RequestCompanyResearchBodySchema.parse(req.body ?? {});

      const result = await commandService.requestCompanyResearch(
        userId,
        params.leadId,
        { ...query, force: body.force },
      );

      reply.code(202);
      return result;
    },
  );

  // GET /leads/:leadId/company-research/status/:researchId - Get research status
  app.get(
    "/leads/:leadId/company-research/status/:researchId",
    async (req) => {
      const userId = requireRequestUserId(req);

      const params = CompanyResearchStatusParamsSchema.parse(req.params);

      return await commandService.getResearchStatus(
        userId,
        params.leadId,
        params.researchId,
      );
    },
  );

  // GET /leads/:leadId/company-research - Get latest completed research
  app.get("/leads/:leadId/company-research", async (req) => {
    const userId = requireRequestUserId(req);

    const params = CompanyResearchParamsSchema.parse(req.params);

    return await queryService.getCompanyResearchHistory(userId, params.leadId);
  });

  // GET /leads/:leadId/company-research/history - Get saved research history
  app.get("/leads/:leadId/company-research/history", async (req) => {
    const userId = requireRequestUserId(req);

    const params = CompanyResearchParamsSchema.parse(req.params);

    return await queryService.getCompanyResearchHistory(userId, params.leadId);
  });
}
