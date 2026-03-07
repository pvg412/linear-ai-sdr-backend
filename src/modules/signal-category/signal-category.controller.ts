import type { FastifyInstance } from "fastify";
import { SignalCategory, UserRole } from "@prisma/client";

import { requireRequestUser } from "@/infra/auth/requestUser";
import { UserFacingError } from "@/infra/userFacingError";
import { container } from "@/container";

import { SIGNAL_CATEGORY_TYPES } from "./signal-category.types";
import type { SignalCategoryRepository } from "./persistence/signal-category.repository";
import { upsertSignalCategoriesBodySchema } from "./schemas/signal-category.schemas";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** All signal categories the system supports (provider-agnostic). */
const ALL_CATEGORIES = Object.values(SignalCategory) as SignalCategory[];

/** Human-readable labels shown to the company (no provider names). */
const CATEGORY_LABELS: Record<SignalCategory, { label: string; hint: string }> = {
  HIRING: {
    label: "Hiring Activity",
    hint: "Describe what kind of job postings or hiring patterns indicate a good prospect for your services.",
  },
  FUNDING: {
    label: "Funding & Growth",
    hint: "Describe what funding rounds, amounts, or growth signals indicate a company is ready to buy.",
  },
  COMMUNITY: {
    label: "Community Presence",
    hint: "Describe what community discussions or social mentions make a prospect relevant to you.",
  },
};

function requireCompanyUser(req: { user?: { id: string; role: string } }) {
  const user = requireRequestUser(req as Parameters<typeof requireRequestUser>[0]);
  if (user.role !== UserRole.COMPANY) {
    throw new UserFacingError({
      code: "FORBIDDEN",
      userMessage: "Only company accounts can manage signal categories",
    });
  }
  return { companyId: user.id };
}

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

export function registerSignalCategoryRoutes(app: FastifyInstance): void {
  const repo = container.get<SignalCategoryRepository>(
    SIGNAL_CATEGORY_TYPES.SignalCategoryRepository,
  );

  /**
   * GET /company/signal-categories
   *
   * Returns all available signal categories with the company's current
   * configuration. Categories without a saved config appear with defaults
   * (enabled: true, description: null).
   */
  app.get("/company/signal-categories", async (req) => {
    const { companyId } = requireCompanyUser(req);

    const saved = await repo.listByCompany(companyId);
    const savedMap = new Map(saved.map((s) => [s.category, s]));

    return ALL_CATEGORIES.map((cat) => {
      const config = savedMap.get(cat);
      const meta = CATEGORY_LABELS[cat];

      return {
        category: cat,
        label: meta.label,
        hint: meta.hint,
        enabled: config?.enabled ?? true,
        description: config?.description ?? null,
        updatedAt: config?.updatedAt ?? null,
      };
    });
  });

  /**
   * PUT /company/signal-categories
   *
   * Upsert signal category configurations. Accepts an array of categories
   * with their descriptions and enabled flags. Only provided categories
   * are updated — omitted ones keep their current state (or default).
   */
  app.put("/company/signal-categories", async (req) => {
    const { companyId } = requireCompanyUser(req);
    const { categories } = upsertSignalCategoriesBodySchema.parse(req.body);

    await repo.upsertMany(
      companyId,
      categories.map((c) => ({
        category: c.category,
        description: c.description,
        enabled: c.enabled,
      })),
    );

    // Return full state after update
    const saved = await repo.listByCompany(companyId);
    const savedMap = new Map(saved.map((s) => [s.category, s]));

    return ALL_CATEGORIES.map((cat) => {
      const config = savedMap.get(cat);
      const meta = CATEGORY_LABELS[cat];

      return {
        category: cat,
        label: meta.label,
        hint: meta.hint,
        enabled: config?.enabled ?? true,
        description: config?.description ?? null,
        updatedAt: config?.updatedAt ?? null,
      };
    });
  });
}
