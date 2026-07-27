import { NextFunction, Request, Response } from "express";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { redis } from "../lib/redis";
import { env } from "../lib/env";
import { TooManyRequestsError } from "../errors";

// A Redis outage must degrade rate limiting to a best-effort, per-process limiter
// rather than take down URL creation entirely, hence the in-memory `insuranceLimiter`.
const insuranceLimiter = new RateLimiterMemory({
  points: env.RATE_LIMIT_POINTS,
  duration: env.RATE_LIMIT_WINDOW_SECONDS,
});

const limiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:create",
  points: env.RATE_LIMIT_POINTS,
  duration: env.RATE_LIMIT_WINDOW_SECONDS,
  insuranceLimiter,
});

export async function createUrlRateLimiter(req: Request, _res: Response, next: NextFunction) {
  try {
    await limiter.consume(req.ip ?? "unknown");
    next();
  } catch (rejection) {
    const retryAfterSeconds =
      rejection && typeof rejection === "object" && "msBeforeNext" in rejection
        ? Math.ceil((rejection as { msBeforeNext: number }).msBeforeNext / 1000)
        : env.RATE_LIMIT_WINDOW_SECONDS;
    next(new TooManyRequestsError("rate limit exceeded for short URL creation", retryAfterSeconds));
  }
}
