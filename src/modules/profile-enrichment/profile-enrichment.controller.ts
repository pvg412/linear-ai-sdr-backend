import type { FastifyInstance } from "fastify";

import { container } from "@/container";
import { requireRequestUser } from "@/infra/auth/requestUser";

import { PROFILE_ENRICHMENT_TYPES } from "./profile-enrichment.types";
import { ProfileEnrichmentCommandService } from "./services/profile-enrichment.command.service";
import { ProfileEnrichmentQueryService } from "./services/profile-enrichment.query.service";
import {
  ProfileEnrichmentParamsSchema,
  ProfileEnrichmentStatusParamsSchema,
  RequestEnrichmentBodySchema,
  ReviewEnrichmentBodySchema,
  EnrichmentHistoryQuerySchema,
} from "./schemas/profile-enrichment.schemas";

const commandService = container.get<ProfileEnrichmentCommandService>(
  PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentCommandService,
);
const queryService = container.get<ProfileEnrichmentQueryService>(
  PROFILE_ENRICHMENT_TYPES.ProfileEnrichmentQueryService,
);

export function registerProfileEnrichmentRoutes(app: FastifyInstance): void {
  // POST /leads/:leadId/enrichment - Start enrichment for a lead
  app.post("/leads/:leadId/enrichment", async (req, reply) => {
    const user = requireRequestUser(req);

    const params = ProfileEnrichmentParamsSchema.parse(req.params);
    const body = RequestEnrichmentBodySchema.parse(req.body ?? {});

    const result = await commandService.requestEnrichment(
      user.id,
      params.leadId,
      body.force,
    );

    reply.code(202);
    return result;
  });

  // GET /leads/:leadId/enrichment/status/:enrichmentRequestId - Get enrichment status
  app.get(
    "/leads/:leadId/enrichment/status/:enrichmentRequestId",
    async (req) => {
      const user = requireRequestUser(req);

      const params = ProfileEnrichmentStatusParamsSchema.parse(req.params);

      return await queryService.getEnrichmentStatus(
        user.id,
        params.leadId,
        params.enrichmentRequestId,
      );
    },
  );

  // GET /leads/:leadId/enrichment/pending - Get pending enrichment changes
  app.get("/leads/:leadId/enrichment/pending", async (req) => {
    const user = requireRequestUser(req);

    const params = ProfileEnrichmentParamsSchema.parse(req.params);

    return await queryService.getPendingEnrichment(user.id, params.leadId);
  });

  // PATCH /leads/:leadId/enrichment/review - Approve/reject field changes
  app.patch("/leads/:leadId/enrichment/review", async (req) => {
    const user = requireRequestUser(req);

    const params = ProfileEnrichmentParamsSchema.parse(req.params);
    const body = ReviewEnrichmentBodySchema.parse(req.body);

    return await commandService.reviewFieldChanges(
      user.id,
      params.leadId,
      body.decisions,
    );
  });

  // GET /leads/:leadId/enrichment/history - Get enrichment history
  app.get("/leads/:leadId/enrichment/history", async (req) => {
    const user = requireRequestUser(req);

    const params = ProfileEnrichmentParamsSchema.parse(req.params);
    const query = EnrichmentHistoryQuerySchema.parse(req.query);

    return await queryService.getEnrichmentHistory(user.id, params.leadId, {
      page: query.page,
      perPage: query.perPage,
    });
  });
}
