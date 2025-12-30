import type { Container } from "inversify";

import { REALTIME_TYPES } from "./realtime.types";
import { RealtimeHub } from "./realtimeHub";

export function registerRealtimeModule(container: Container) {
  container
	.bind<RealtimeHub>(REALTIME_TYPES.RealtimeHub)
	.to(RealtimeHub)
	.inSingletonScope();
}