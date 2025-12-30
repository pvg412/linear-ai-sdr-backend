import type { Container } from "inversify";

import { loadEnv } from "@/config/env";
import { AI_TYPES } from "./ai.types";
import { AiPromptParserService } from "./ai-prompt-parser.service";

const env = loadEnv();

const isOpenAiEnabled = Boolean(env.OPENAI_API_KEY && env.OPENAI_MODEL);

export function registerAiModule(container: Container) {
	if (isOpenAiEnabled) {
		container
			.bind<AiPromptParserService>(AI_TYPES.AiPromptParserService)
			.toDynamicValue(() => {
				return new AiPromptParserService(
					env.OPENAI_API_KEY!,
					env.OPENAI_MODEL!
				);
			})
			.inSingletonScope();
	}
}
