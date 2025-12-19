export const CHAT_TYPES = {
  ChatRepository: Symbol.for("ChatRepository"),
  ChatCommandService: Symbol.for("ChatCommandService"),
  ChatQueryService: Symbol.for("ChatQueryService"),
  ChatPromptParser: Symbol.for("ChatPromptParser"),
  ChatController: Symbol.for("ChatController"),
} as const;