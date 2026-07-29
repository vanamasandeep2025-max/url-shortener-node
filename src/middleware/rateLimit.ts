import { NextFunction, Request, Response } from "express";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { redis } from "../lib/redis";
import { env } from "../lib/env";
import { TooManyRequestsError } from "../errors";

function retryAfterSecondsFrom(rejection: unknown, fallbackSeconds: number): number {
  return rejection && typeof rejection === "object" && "msBeforeNext" in rejection
    ? Math.ceil((rejection as { msBeforeNext: number }).msBeforeNext / 1000)
    : fallbackSeconds;
}

// A Redis outage must degrade rate limiting to a best-effort, per-process limiter
// rather than take down URL creation entirely, hence the in-memory `insuranceLimiter`.
const createInsuranceLimiter = new RateLimiterMemory({
  points: env.RATE_LIMIT_POINTS,
  duration: env.RATE_LIMIT_WINDOW_SECONDS,
});

const createLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:create",
  points: env.RATE_LIMIT_POINTS,
  duration: env.RATE_LIMIT_WINDOW_SECONDS,
  insuranceLimiter: createInsuranceLimiter,
});

export async function createUrlRateLimiter(req: Request, _res: Response, next: NextFunction) {
  try {
    await createLimiter.consume(req.ip ?? "unknown");
    next();
  } catch (rejection) {
    next(
      new TooManyRequestsError(
        "rate limit exceeded for short URL creation",
        retryAfterSecondsFrom(rejection, env.RATE_LIMIT_WINDOW_SECONDS),
      ),
    );
  }
}

// Separate, stricter limiter for password guesses against a protected link, keyed by
// IP *and* code so brute-forcing one link can't be masked by -- or drown out -- traffic
// to any other link.
const unlockInsuranceLimiter = new RateLimiterMemory({
  points: env.UNLOCK_RATE_LIMIT_POINTS,
  duration: env.UNLOCK_RATE_LIMIT_WINDOW_SECONDS,
});

const unlockLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:unlock",
  points: env.UNLOCK_RATE_LIMIT_POINTS,
  duration: env.UNLOCK_RATE_LIMIT_WINDOW_SECONDS,
  insuranceLimiter: unlockInsuranceLimiter,
});

export async function unlockAttemptRateLimiter(req: Request, _res: Response, next: NextFunction) {
  try {
    await unlockLimiter.consume(`${req.ip ?? "unknown"}:${req.params.code}`);
    next();
  } catch (rejection) {
    next(
      new TooManyRequestsError(
        "too many password attempts, please try again later",
        retryAfterSecondsFrom(rejection, env.UNLOCK_RATE_LIMIT_WINDOW_SECONDS),
      ),
    );
  }
}
