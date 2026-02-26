import type { Container } from "inversify";

import { loadEnv } from "@/config/env";
import { ADMIN_TYPES } from "@/modules/admin/admin.types";
import type { ServiceToggleService } from "@/modules/admin/services/service-toggle.service";

import type { SignalProvider } from "./signal-provider.dto";
import { HIRING_SIGNAL_TYPES } from "./hiring-signals.types";
import { HirebaseProvider } from "./providers/hirebase/hirebase.provider";

const env = loadEnv();

export function registerHiringSignalsModule(container: Container): void {
  container
    .bind<SignalProvider>(HIRING_SIGNAL_TYPES.SignalProvider)
    .toDynamicValue(() => {
      const toggleService = container.get<ServiceToggleService>(
        ADMIN_TYPES.ServiceToggleService,
      );
      return new HirebaseProvider(env.HIREBASE_API_KEY ?? "", toggleService);
    })
    .inSingletonScope();
}
