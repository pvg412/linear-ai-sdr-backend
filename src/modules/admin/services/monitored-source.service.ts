import { injectable, inject } from "inversify";
import type { MonitoredSourceChannel } from "@prisma/client";

import { ADMIN_TYPES } from "../admin.types";
import { MonitoredSourceRepository } from "../persistence/monitored-source.repository";
import { UserFacingError } from "@/infra/userFacingError";
import { isP2002Unique } from "@/infra/observability";
import type { MonitoredSourceResponse } from "../schemas/monitored-source.schemas";

@injectable()
export class MonitoredSourceService {
  constructor(
    @inject(ADMIN_TYPES.MonitoredSourceRepository)
    private readonly repository: MonitoredSourceRepository,
  ) {}

  async list(channel?: MonitoredSourceChannel): Promise<MonitoredSourceResponse[]> {
    const sources = await this.repository.findAll(channel);
    return sources.map(toResponse);
  }

  async create(
    data: { channel: MonitoredSourceChannel; value: string; description?: string },
    userId: string,
  ): Promise<MonitoredSourceResponse> {
    try {
      const source = await this.repository.create({
        channel: data.channel,
        value: data.value,
        description: data.description,
        updatedById: userId,
      });
      return toResponse(source);
    } catch (e) {
      if (isP2002Unique(e)) {
        throw new UserFacingError({
          code: "CONFLICT",
          userMessage: `Source "${data.value}" already exists for channel ${data.channel}`,
        });
      }
      throw e;
    }
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    userId: string,
  ): Promise<MonitoredSourceResponse> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Monitored source not found",
      });
    }

    const updated = await this.repository.updateEnabled(id, enabled, userId);
    return toResponse(updated);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function toResponse(row: {
  id: string;
  channel: MonitoredSourceChannel;
  value: string;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): MonitoredSourceResponse {
  return {
    id: row.id,
    channel: row.channel,
    value: row.value,
    description: row.description,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
