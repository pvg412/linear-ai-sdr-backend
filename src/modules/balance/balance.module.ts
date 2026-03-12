import type { Container } from "inversify";

import { BALANCE_TYPES } from "./balance.types";
import { BalanceRepository } from "./persistence/balance.repository";
import { BalanceCommandService } from "./services/balance.command.service";
import { BalanceQueryService } from "./services/balance.query.service";

export function registerBalanceModule(container: Container): void {
  container
    .bind<BalanceRepository>(BALANCE_TYPES.BalanceRepository)
    .to(BalanceRepository)
    .inSingletonScope();

  container
    .bind<BalanceCommandService>(BALANCE_TYPES.BalanceCommandService)
    .to(BalanceCommandService)
    .inSingletonScope();

  container
    .bind<BalanceQueryService>(BALANCE_TYPES.BalanceQueryService)
    .to(BalanceQueryService)
    .inSingletonScope();
}
