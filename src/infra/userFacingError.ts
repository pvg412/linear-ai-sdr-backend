export class UserFacingError extends Error {
  public readonly userMessage: string;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(params: {
    userMessage: string;
    code?: string;
    debugMessage?: string;
    details?: Record<string, unknown>;
  }) {
    super(params.debugMessage ?? params.userMessage);
    this.userMessage = params.userMessage;
    this.code = params.code ?? "USER_ERROR";
    this.details = params.details;
  }
}

export function getUserFacingMessage(error: unknown): string | undefined {
  if (error instanceof UserFacingError) return error.userMessage;
  return undefined;
}

