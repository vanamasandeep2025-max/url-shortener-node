import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.REDIS_URL, {
  // Redis backs an optional cache/rate-limiter, not a hard dependency (see urlService's
  // fail-open handling). With the offline queue on, a down Redis makes every command wait
  // through several reconnect backoffs before rejecting -- observed to take 20s+ in practice,
  // which defeats the point of failing open on the redirect hot path. Disabling the offline
  // queue makes commands reject immediately whenever the connection isn't currently ready.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  lazyConnect: false,
});

redis.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Redis connection error:", err.message);
});
