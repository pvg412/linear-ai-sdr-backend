import type { Container } from "inversify";

import { loadEnv } from "@/config/env";
import { ADMIN_TYPES } from "@/modules/admin/admin.types";
import type { ServiceToggleService } from "@/modules/admin/services/service-toggle.service";

import type { RedditSignalProvider } from "./reddit-signal-provider.dto";
import { REDDIT_SIGNAL_TYPES } from "./reddit-signals.types";
import { RedditApifyProvider } from "./providers/reddit-apify/reddit-apify.provider";

const env = loadEnv();

export function registerRedditSignalsModule(container: Container): void {
  container
    .bind<RedditSignalProvider>(REDDIT_SIGNAL_TYPES.RedditSignalProvider)
    .toDynamicValue(() => {
      const toggleService = container.get<ServiceToggleService>(
        ADMIN_TYPES.ServiceToggleService,
      );
      return new RedditApifyProvider(env.APIFY_TOKEN ?? "", toggleService);
    })
    .inSingletonScope();
}
