import type { Container } from "inversify";

import { ICP_TYPES } from "./icp.types";
import { IcpRepository } from "./persistence/icp.repository";

export function registerIcpModule(container: Container): void {
  container
    .bind<IcpRepository>(ICP_TYPES.IcpRepository)
    .to(IcpRepository)
    .inSingletonScope();
}
