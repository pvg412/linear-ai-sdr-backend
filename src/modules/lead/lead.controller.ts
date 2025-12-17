import { FastifyInstance } from "fastify";

// import { container } from "@/container";
// import { LEAD_TYPES } from "./lead.types";
// import {
//   bulkCreateLeadsBodySchema,
//   getLeadParamsSchema,
//   getLeadsBySearchTaskParamsSchema,
//   getLeadsQuerySchema,
//   updateLeadStatusBodySchema,
// } from "./lead.schemas";
// import { LeadCommandService } from "./lead.commandService";
// import { LeadQueryService } from "./lead.queryService";

export function registerLeadRoutes(_: FastifyInstance) {
  // const commandService = container.get<LeadCommandService>(
  //   LEAD_TYPES.LeadCommandService
  // );
  // const queryService = container.get<LeadQueryService>(
  //   LEAD_TYPES.LeadQueryService
  // );

  // app.post("/leads/bulk", async (request, reply) => {
  //   const body = bulkCreateLeadsBodySchema.parse(request.body);
  //   const result = await commandService.bulkCreateForSearchTask(body);
  //   reply.code(201).send(result);
  // });

  // app.patch("/leads/:id/status", async (request, reply) => {
  //   const params = getLeadParamsSchema.parse(request.params);
  //   const body = updateLeadStatusBodySchema.parse(request.body);

  //   const lead = await commandService.updateStatus(params.id, body.status);
  //   reply.send(lead);
  // });

  // app.get("/leads/:id", async (request, reply) => {
  //   const params = getLeadParamsSchema.parse(request.params);
  //   const lead = await queryService.getById(params.id);

  //   if (!lead) {
  //     return reply.code(404).send({ message: "Lead not found" });
  //   }

  //   return lead;
  // });

  // app.get("/search-tasks/:searchTaskId/leads", async (request, _) => {
  //   const params = getLeadsBySearchTaskParamsSchema.parse(request.params);
  //   const query = getLeadsQuerySchema.parse(request.query);

  //   const leads = await queryService.getBySearchTaskId(params.searchTaskId, {
  //     status: query.status,
  //     limit: query.limit,
  //     offset: query.offset,
  //   });

  //   return leads;
  // });
}
