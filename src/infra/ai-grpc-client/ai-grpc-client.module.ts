import type { Container } from "inversify";

import { AiGrpcClient } from "./ai-grpc-client";
import { AI_GRPC_CLIENT_TYPES } from "./ai-grpc-client.types";

export function registerAiGrpcClientModule(container: Container) {
  container
    .bind(AI_GRPC_CLIENT_TYPES.AiGrpcClient)
    .toDynamicValue(() => AiGrpcClient.fromEnv())
    .inSingletonScope();
}
