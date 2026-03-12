export const BALANCE_TYPES = {
  BalanceRepository: Symbol.for("BalanceRepository"),
  BalanceQueryService: Symbol.for("BalanceQueryService"),
  BalanceCommandService: Symbol.for("BalanceCommandService"),
} as const;
