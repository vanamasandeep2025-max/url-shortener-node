import { NextFunction, Request, Response } from "express";
import { AppError, TooManyRequestsError } from "../errors";
import { logger } from "../lib/logger";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { message: `no route for ${req.method} ${req.path}`, code: "NOT_FOUND" } });
}

function isHttpErrorLike(err: unknown): err is Error & { statusCode?: number; status?: number } {
  return err instanceof Error && (typeof (err as { statusCode?: unknown }).statusCode === "number" ||
    typeof (err as { status?: unknown }).status === "number");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err instanceof TooManyRequestsError && err.retryAfterSeconds) {
      res.set("Retry-After", String(err.retryAfterSeconds));
    }
    res.status(err.statusCode).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
    return;
  }

  // body-parser (and other Express middleware) throw plain Errors with a `status`/`statusCode`
  // for client-caused problems (e.g. malformed JSON) -- those are 4xx client errors, not
  // server faults, and shouldn't be logged at error level or reported as a 500.
  if (isHttpErrorLike(err)) {
    const statusCode = err.statusCode ?? err.status ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      res.status(statusCode).json({ error: { message: err.message, code: "BAD_REQUEST" } });
      return;
    }
  }

  logger.error({ err, path: req.path, method: req.method }, "unhandled error");
  res.status(500).json({ error: { message: "internal server error", code: "INTERNAL_ERROR" } });
}
