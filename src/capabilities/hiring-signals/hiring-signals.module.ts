import type { Container } from "inversify";

import { loadEnv } from "@/config/env";

import type { SignalProvider } from "./signal-provider.dto";
import { HIRING_SIGNAL_TYPES } from "./hiring-signals.types";
import { HirebaseProvider } from "./providers/hirebase/hirebase.provider";

const env = loadEnv();

export function registerHiringSignalsModule(container: Container): void {
  container
    .bind<SignalProvider>(HIRING_SIGNAL_TYPES.SignalProvider)
    .toDynamicValue(() => new HirebaseProvider(env.HIREBASE_API_KEY ?? ""))
    .inSingletonScope();
}
