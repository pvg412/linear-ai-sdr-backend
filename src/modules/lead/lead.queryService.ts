import { inject, injectable } from "inversify";
import { LeadStatus } from "@prisma/client";

import { LEAD_TYPES } from "./lead.types";
import { LeadRepository } from "./lead.repository";

type GetBySearchTaskOptions = {
  status?: LeadStatus;
  limit?: number;
  offset?: number;
};

@injectable()
export class LeadQueryService {
  constructor(
    @inject(LEAD_TYPES.LeadRepository)
    private readonly leadRepository: LeadRepository
  ) {}

  async getById(id: string) {
    return this.leadRepository.findById(id);
  }

  async getBySearchTaskId(
    searchTaskId: string,
    options: GetBySearchTaskOptions = {}
  ) {
    return this.leadRepository.findBySearchTaskId(searchTaskId, {
      status: options.status,
      limit: options.limit ?? 100,
      offset: options.offset ?? 0,
    });
  }
}
