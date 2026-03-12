import { inject, injectable } from "inversify";

import { BALANCE_TYPES } from "../balance.types";
import type { BalanceRepository, BalanceAuditEntry } from "../persistence/balance.repository";
import { centsToDollars } from "./balance.command.service";

export type BalanceDto = {
  balanceCents: number;
  balanceDollars: string;
};

export type AuditLogDto = {
  entries: (BalanceAuditEntry & { amountDollars: string; balanceBeforeDollars: string; balanceAfterDollars: string })[];
  total: number;
  page: number;
  perPage: number;
};

@injectable()
export class BalanceQueryService {
  constructor(
    @inject(BALANCE_TYPES.BalanceRepository)
    private readonly balanceRepository: BalanceRepository,
  ) {}

  async getBalance(userId: string): Promise<BalanceDto> {
    const { balanceCents } = await this.balanceRepository.getUserBalance(userId);
    return {
      balanceCents,
      balanceDollars: centsToDollars(balanceCents),
    };
  }

  async getAuditLog(userId: string, page: number, perPage: number): Promise<AuditLogDto> {
    const { entries, total } = await this.balanceRepository.getAuditLog(userId, page, perPage);

    return {
      entries: entries.map((e) => ({
        ...e,
        amountDollars: centsToDollars(e.amountCents),
        balanceBeforeDollars: centsToDollars(e.balanceBefore),
        balanceAfterDollars: centsToDollars(e.balanceAfter),
      })),
      total,
      page,
      perPage,
    };
  }
}
