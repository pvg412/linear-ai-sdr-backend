import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";

import { container } from "@/container";
import { requireRequestUser } from "@/infra/auth/requestUser";
import { UserFacingError } from "@/infra/userFacingError";

import { BALANCE_TYPES } from "./balance.types";
import type { BalanceCommandService } from "./services/balance.command.service";
import type { BalanceQueryService } from "./services/balance.query.service";
import type { BalanceRepository } from "./persistence/balance.repository";
import {
  AdjustBalanceBodySchema,
  AuditLogQuerySchema,
  UserIdentifierParamsSchema,
} from "./schemas/balance.schemas";
import { centsToDollars } from "./services/balance.command.service";

function requireAdmin(role: string): void {
  if (role !== UserRole.ADMIN) {
    throw new UserFacingError({
      code: "FORBIDDEN",
      userMessage: "Admin access required.",
    });
  }
}

export function registerBalanceRoutes(app: FastifyInstance): void {
  const commandService = container.get<BalanceCommandService>(BALANCE_TYPES.BalanceCommandService);
  const queryService = container.get<BalanceQueryService>(BALANCE_TYPES.BalanceQueryService);
  const balanceRepository = container.get<BalanceRepository>(BALANCE_TYPES.BalanceRepository);

  // ── GET /balance/me ─────────────────────────────────────────────────────────
  // Returns the current authenticated user's balance.

  app.get("/balance/me", async (req) => {
    const user = requireRequestUser(req);
    return queryService.getBalance(user.id);
  });

  // ── GET /balance/:userIdentifier ─────────────────────────────────────────────
  // Admin-only: look up any user's balance by UUID or email.

  app.get("/balance/:userIdentifier", async (req) => {
    const performer = requireRequestUser(req);
    requireAdmin(performer.role);

    const { userIdentifier } = UserIdentifierParamsSchema.parse(req.params);
    const resolved = await balanceRepository.resolveUserByIdentifier(userIdentifier);

    return {
      balanceCents: resolved.balanceCents,
      balanceDollars: centsToDollars(resolved.balanceCents),
      user: {
        id: resolved.id,
        email: resolved.email,
        role: resolved.role,
      },
    };
  });

  // ── POST /balance/:userIdentifier/adjust ─────────────────────────────────────
  // Admin-only: adjust a user's balance (credit or debit).
  // This is the ONLY endpoint that can change a user's balance.

  app.post("/balance/:userIdentifier/adjust", async (req) => {
    const performer = requireRequestUser(req);
    requireAdmin(performer.role);

    const { userIdentifier } = UserIdentifierParamsSchema.parse(req.params);
    const { amountCents, reason } = AdjustBalanceBodySchema.parse(req.body);

    // Resolve identifier → canonical userId before passing to command service
    const resolved = await balanceRepository.resolveUserByIdentifier(userIdentifier);

    return commandService.adjustBalance({
      userId: resolved.id,
      amountCents,
      reason,
      performedById: performer.id,
    });
  });

  // ── GET /balance/:userIdentifier/audit-log ───────────────────────────────────
  // Admin-only: full audit log for a user's balance changes, paginated.

  app.get("/balance/:userIdentifier/audit-log", async (req) => {
    const performer = requireRequestUser(req);
    requireAdmin(performer.role);

    const { userIdentifier } = UserIdentifierParamsSchema.parse(req.params);
    const { page, perPage } = AuditLogQuerySchema.parse(req.query);

    // Resolve identifier → canonical userId
    const resolved = await balanceRepository.resolveUserByIdentifier(userIdentifier);

    return queryService.getAuditLog(resolved.id, page, perPage);
  });
}
