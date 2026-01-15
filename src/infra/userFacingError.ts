export class UserFacingError extends Error {
  public readonly userMessage: string;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly debugMessage?: string;

  constructor(params: {
    userMessage: string;
    code?: string;
    debugMessage?: string;
    details?: Record<string, unknown>;
  }) {
    // IMPORTANT: Error.message is considered unsafe to expose.
    // Keep it user-safe to reduce accidental leaks in handlers.
    super(params.userMessage);
    this.userMessage = params.userMessage;
    this.code = params.code ?? "USER_ERROR";
    this.details = params.details;
    this.debugMessage = params.debugMessage;
  }
}

export function getUserFacingMessage(error: unknown): string | undefined {
  if (error instanceof UserFacingError) return error.userMessage;
  return undefined;
}

