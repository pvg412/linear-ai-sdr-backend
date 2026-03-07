import type { Container } from "inversify";

import { loadEnv } from "@/config/env";
import { ADMIN_TYPES } from "@/modules/admin/admin.types";
import type { ServiceToggleService } from "@/modules/admin/services/service-toggle.service";

import type { CrunchbaseSignalProvider } from "./crunchbase-signal-provider.dto";
import { CRUNCHBASE_SIGNAL_TYPES } from "./crunchbase-signals.types";
import { CrunchbaseApifyProvider } from "./providers/crunchbase-apify/crunchbase-apify.provider";

const env = loadEnv();

export function registerCrunchbaseSignalsModule(container: Container): void {
  container
    .bind<CrunchbaseSignalProvider>(CRUNCHBASE_SIGNAL_TYPES.CrunchbaseSignalProvider)
    .toDynamicValue(() => {
      const toggleService = container.get<ServiceToggleService>(
        ADMIN_TYPES.ServiceToggleService,
      );
      return new CrunchbaseApifyProvider(env.APIFY_TOKEN ?? "", toggleService);
    })
    .inSingletonScope();
}
