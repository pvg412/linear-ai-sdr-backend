import type { FastifyInstance } from "fastify";
import { SignalCategory, UserRole } from "@prisma/client";

import { requireRequestUser } from "@/infra/auth/requestUser";
import { UserFacingError } from "@/infra/userFacingError";
import { container } from "@/container";


import { SIGNAL_CATEGORY_TYPES } from "./signal-category.types";
import type { SignalCategoryRepository } from "./persistence/signal-category.repository";
import {
  serviceCatalogIdParamSchema,
  upsertSignalCategoriesBodySchema,
} from "./schemas/signal-category.schemas";
import { SERVICE_CATALOG_TYPES } from "../service-catalog/service-catalog.types";
import type { ServiceCatalogRepository } from "../service-catalog/persistence/service-catalog.repository";
import { AI_GRPC_CLIENT_TYPES } from "@/infra/ai-grpc-client/ai-grpc-client.types";
import type { AiGrpcClient } from "@/infra/ai-grpc-client/ai-grpc-client";

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
  const serviceCatalogRepo = container.get<ServiceCatalogRepository>(
    SERVICE_CATALOG_TYPES.ServiceCatalogRepository,
  );
  const aiGrpcClient = container.get<AiGrpcClient>(
    AI_GRPC_CLIENT_TYPES.AiGrpcClient,
  );

  /**
   * Assert that the service catalog exists and belongs to the company.
   */
  async function assertCatalogOwnership(
    companyId: string,
    serviceCatalogId: string,
  ): Promise<void> {
    const catalog = await serviceCatalogRepo.findServiceById(serviceCatalogId);
    if (!catalog || catalog.companyId !== companyId) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Service catalog not found",
      });
    }
  }

  /**
   * GET /company/service-catalog/:serviceCatalogId/signal-categories
   *
   * Returns all available signal categories with the catalog's current
   * configuration. Categories without a saved config appear with defaults
   * (enabled: true, description: null).
   */
  app.get(
    "/company/service-catalog/:serviceCatalogId/signal-categories",
    async (req) => {
      const { companyId } = requireCompanyUser(req);
      const { serviceCatalogId } = serviceCatalogIdParamSchema.parse(req.params);

      await assertCatalogOwnership(companyId, serviceCatalogId);

      const saved = await repo.listByServiceCatalog(serviceCatalogId);
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
    },
  );

  /**
   * PUT /company/service-catalog/:serviceCatalogId/signal-categories
   *
   * Upsert signal category configurations for a specific service catalog.
   * Accepts an array of categories with their descriptions and enabled flags.
   * Only provided categories are updated — omitted ones keep their current state.
   *
   * After saving, calls ExpandSignalDescriptions gRPC to generate HyDE-expanded
   * embeddings for semantic vector search. The expanded descriptions are cached
   * in the DB so they don't need to be recomputed on every pipeline run.
   */
  app.put(
    "/company/service-catalog/:serviceCatalogId/signal-categories",
    async (req) => {
      const { companyId } = requireCompanyUser(req);
      const { serviceCatalogId } = serviceCatalogIdParamSchema.parse(req.params);
      const { categories } = upsertSignalCategoriesBodySchema.parse(req.body);

      await assertCatalogOwnership(companyId, serviceCatalogId);

      await repo.upsertMany(
        serviceCatalogId,
        categories.map((c) => ({
          category: c.category,
          description: c.description,
          enabled: c.enabled,
        })),
      );

      // ── Async: expand signal descriptions via HyDE (AI service) ───────
      // Non-blocking: if gRPC fails, we log a warning and continue.
      // The expandedDescription will remain null and the AI will fall back
      // to using the raw description for ChromaDB embedding queries.
      void (async () => {
        try {
          // Only expand enabled categories that have a non-empty description
          const toExpand = categories
            .filter((c) => c.enabled && c.description.trim().length > 0)
            .map((c) => ({
              catalogName: serviceCatalogId,
              category: c.category,
              description: c.description.trim(),
            }));

          if (toExpand.length === 0) return;

          const expandResp = await aiGrpcClient.expandSignalDescriptions({
            requestId: "",
            descriptions: toExpand,
            serviceContext: "",
          });

          // Persist expanded descriptions back to DB.
          // Match by category (both catalogName and category are echoed back in the response).
          await Promise.allSettled(
            expandResp.expanded.map(async (expanded) => {
              if (!expanded.expandedText?.trim()) return;
              if (!expanded.category) return;

              await repo.updateExpandedDescription(
                serviceCatalogId,
                expanded.category as SignalCategory,
                expanded.expandedText.trim(),
              );
            }),
          );

          console.info(
            "[signal-category] descriptions expanded and cached",
            { serviceCatalogId, expanded: expandResp.expanded.length },
          );
        } catch (err) {
          console.warn(
            "[signal-category] ExpandSignalDescriptions gRPC failed (non-fatal)",
            { serviceCatalogId, err: err instanceof Error ? err.message : String(err) },
          );
        }
      })();

      // Return full state after update (without waiting for HyDE expansion)
      const saved = await repo.listByServiceCatalog(serviceCatalogId);
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
    },
  );
}
