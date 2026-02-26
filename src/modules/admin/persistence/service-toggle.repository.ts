import { injectable } from "inversify";
import { getPrisma } from "@/infra/prisma";

@injectable()
export class ServiceToggleRepository {
  private readonly prisma = getPrisma();

  async findAll() {
    return this.prisma.serviceToggle.findMany({
      orderBy: { createdAt: "asc" },
    });
  }

  async findByServiceKey(serviceKey: string) {
    return this.prisma.serviceToggle.findUnique({
      where: { serviceKey },
    });
  }

  async findById(id: string) {
    return this.prisma.serviceToggle.findUnique({
      where: { id },
    });
  }

  async updateEnabled(id: string, enabled: boolean, updatedById: string) {
    return this.prisma.serviceToggle.update({
      where: { id },
      data: { enabled, updatedById },
    });
  }

  /**
   * Upsert a toggle entry. Used at startup to seed default toggles
   * without overwriting admin changes.
   */
  async upsertDefault(data: {
    serviceKey: string;
    displayName: string;
    description: string | null;
    category: string;
  }) {
    return this.prisma.serviceToggle.upsert({
      where: { serviceKey: data.serviceKey },
      create: {
        serviceKey: data.serviceKey,
        displayName: data.displayName,
        description: data.description,
        category: data.category,
        enabled: true,
      },
      // Do NOT overwrite `enabled` — admin may have toggled it
      update: {
        displayName: data.displayName,
        description: data.description,
        category: data.category,
      },
    });
  }
}
