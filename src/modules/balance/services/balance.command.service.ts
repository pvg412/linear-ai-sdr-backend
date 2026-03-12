import { inject, injectable } from "inversify";

import { UserFacingError } from "@/infra/userFacingError";
import { BALANCE_TYPES } from "../balance.types";
import type { BalanceRepository } from "../persistence/balance.repository";
import type { BalanceAdjustResult } from "../persistence/balance.repository";

export type AdjustBalanceParams = {
  userId: string;
  amountCents: number;
  reason: string;
  performedById: string;
};

/**
 * The ONLY entry point for modifying a user's balance.
 *
 * All balance writes MUST go through this service's adjustBalance() method.
 * Direct writes to User.balanceCents via Prisma are forbidden — this service
 * guarantees atomicity and the audit trail simultaneously.
 */
@injectable()
export class BalanceCommandService {
  constructor(
    @inject(BALANCE_TYPES.BalanceRepository)
    private readonly balanceRepository: BalanceRepository,
  ) {}

  async adjustBalance(params: AdjustBalanceParams): Promise<BalanceAdjustResult & { balanceDollars: string }> {
    const { userId, amountCents, reason, performedById } = params;

    if (!Number.isInteger(amountCents)) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "amountCents must be an integer.",
      });
    }

    if (amountCents === 0) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "amountCents must not be zero.",
      });
    }

    if (!reason.trim()) {
      throw new UserFacingError({
        code: "BAD_REQUEST",
        userMessage: "reason is required.",
      });
    }

    const result = await this.balanceRepository.adjustBalance(
      userId,
      amountCents,
      reason.trim(),
      performedById,
    );

    return {
      ...result,
      balanceDollars: centsToDollars(result.balanceCents),
    };
  }
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
