import { injectable } from "inversify";
import type { MonitoredSourceChannel } from "@prisma/client";

import { getPrisma } from "@/infra/prisma";

@injectable()
export class MonitoredSourceRepository {
  private readonly prisma = getPrisma();

  async findAll(channel?: MonitoredSourceChannel) {
    return this.prisma.monitoredSource.findMany({
      where: channel ? { channel } : undefined,
      orderBy: { createdAt: "asc" },
    });
  }

  async findById(id: string) {
    return this.prisma.monitoredSource.findUnique({ where: { id } });
  }

  async create(data: {
    channel: MonitoredSourceChannel;
    value: string;
    description?: string | null;
    updatedById?: string;
  }) {
    return this.prisma.monitoredSource.create({
      data: {
        channel: data.channel,
        value: data.value,
        description: data.description ?? null,
        enabled: true,
        updatedById: data.updatedById,
      },
    });
  }

  async updateEnabled(id: string, enabled: boolean, updatedById: string) {
    return this.prisma.monitoredSource.update({
      where: { id },
      data: { enabled, updatedById },
    });
  }
}
