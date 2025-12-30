export type LeadDirectoryErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT";

export class LeadDirectoryError extends Error {
  constructor(
    public readonly code: LeadDirectoryErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "LeadDirectoryError";
  }
}

export class LeadDirectoryValidationError extends LeadDirectoryError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION", message, details);
    this.name = "LeadDirectoryValidationError";
  }
}

export class LeadDirectoryNotFoundError extends LeadDirectoryError {
  constructor(message: string, details?: unknown) {
    super("NOT_FOUND", message, details);
    this.name = "LeadDirectoryNotFoundError";
  }
}

export class LeadDirectoryForbiddenError extends LeadDirectoryError {
  constructor(message: string, details?: unknown) {
    super("FORBIDDEN", message, details);
    this.name = "LeadDirectoryForbiddenError";
  }
}

export class LeadDirectoryConflictError extends LeadDirectoryError {
  constructor(message: string, details?: unknown) {
    super("CONFLICT", message, details);
    this.name = "LeadDirectoryConflictError";
  }
}
