import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";

import { requireRequestUser } from "@/infra/auth/requestUser";
import { UserFacingError } from "@/infra/userFacingError";
import { container } from "@/container";

import { ICP_TYPES } from "./icp.types";
import type { IcpRepository } from "./persistence/icp.repository";
import { upsertIcpBodySchema, COMPANY_SIZE_OPTIONS } from "./schemas/icp.schemas";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function requireCompanyUser(req: { user?: { id: string; role: string } }) {
  const user = requireRequestUser(req as Parameters<typeof requireRequestUser>[0]);
  if (user.role !== UserRole.COMPANY) {
    throw new UserFacingError({
      code: "FORBIDDEN",
      userMessage: "Only company accounts can manage ICP settings",
    });
  }
  return { companyId: user.id };
}

/* ------------------------------------------------------------------ */
/*  Response formatter                                                  */
/* ------------------------------------------------------------------ */

function formatIcpResponse(
  config: {
    locations: string[];
    companySizes: string[];
    industries: { industryId: string; label: string }[];
    updatedAt: Date;
  } | null,
) {
  return {
    locations: config?.locations ?? [],
    companySizes: config?.companySizes ?? [],
    industries: config?.industries.map((i) => ({
      industryId: i.industryId,
      label: i.label,
    })) ?? [],
    updatedAt: config?.updatedAt ?? null,
    companySizeOptions: COMPANY_SIZE_OPTIONS,
  };
}

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

export function registerIcpRoutes(app: FastifyInstance): void {
  const repo = container.get<IcpRepository>(ICP_TYPES.IcpRepository);

  /**
   * GET /company/icp
   *
   * Returns the company's ICP configuration.
   * If no config exists yet, returns empty defaults with the
   * static companySizeOptions reference data.
   */
  app.get("/company/icp", async (req) => {
    const { companyId } = requireCompanyUser(req);
    const config = await repo.getByCompanyId(companyId);
    return formatIcpResponse(config);
  });

  /**
   * PUT /company/icp
   *
   * Upsert the company's ICP configuration.
   * Accepts locations (string[]), companySizes (A-I codes[]),
   * and industries ({ industryId, label }[]).
   */
  app.put("/company/icp", async (req) => {
    const { companyId } = requireCompanyUser(req);
    const body = upsertIcpBodySchema.parse(req.body);

    const config = await repo.upsert(companyId, {
      locations: body.locations,
      companySizes: body.companySizes,
      industries: body.industries,
    });

    return formatIcpResponse(config);
  });
}
