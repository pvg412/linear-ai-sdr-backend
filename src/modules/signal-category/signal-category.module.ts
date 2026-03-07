import type { Container } from "inversify";

import { SIGNAL_CATEGORY_TYPES } from "./signal-category.types";
import { SignalCategoryRepository } from "./persistence/signal-category.repository";

export function registerSignalCategoryModule(container: Container): void {
  container
    .bind<SignalCategoryRepository>(SIGNAL_CATEGORY_TYPES.SignalCategoryRepository)
    .to(SignalCategoryRepository)
    .inSingletonScope();
}
