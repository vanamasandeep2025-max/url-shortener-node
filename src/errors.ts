export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class GoneError extends AppError {
  constructor(message: string) {
    super(message, 410, "GONE");
  }
}

export class TooManyRequestsError extends AppError {
  constructor(
    message = "Too many requests",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message, 429, "TOO_MANY_REQUESTS");
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503, "SERVICE_UNAVAILABLE");
  }
}
