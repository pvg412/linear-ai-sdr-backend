export const CHAT_TYPES = {
  ChatRepository: Symbol.for("ChatRepository"),
  ChatCommandService: Symbol.for("ChatCommandService"),
  ChatQueryService: Symbol.for("ChatQueryService"),
  ChatPromptParser: Symbol.for("ChatPromptParser"),
  ChatAiPromptParserService: Symbol.for("ChatAiPromptParserService"),
  ChatAiStreamService: Symbol.for("ChatAiStreamService"),
  ChatController: Symbol.for("ChatController"),
} as const;