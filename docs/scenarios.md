# Scenarios: Greenfield, Brownfield, Ambiguous

Three worked examples from this actual session, each showing decomposition,
AI-assisted execution, and validation — not hypothetical illustrations.

---

## 1. Greenfield: the whole build

**Requirement (as given)**: "Build a URL shortener service from scratch with
core APIs, analytics, and reliability features."

**Decomposition**: see [task-breakdown.md](task-breakdown.md) in full —
environment setup → scaffold → domain logic → service layer → HTTP layer →
testing → live validation → documentation → version control, each step
gated on the previous one actually working (not just being written).

**Execution**: AI-generated code across all layers based on an
engineer-approved plan (stack, feature depth, project location decided via
direct questions before implementation). See
[ai-usage-log.md](ai-usage-log.md) for exactly what was generated vs.
engineer-directed.

**Validation**: 34 unit tests (mocked dependencies) + 15 integration tests
(real local Postgres, `ioredis-mock` for Redis) + a live server run driven
with real `curl`/`Invoke-RestMethod` requests through every endpoint. This
combination — not the test suite alone — is what surfaced the three defects
below and in the ai-usage-log, which is the point: a green test suite from an
AI-generated first pass is not sufficient evidence of correctness on its own.

---

## 2. Brownfield: fixing the Redis fail-open latency bug

This is a real bug found and fixed on this codebase after its initial build,
with a real before/after diff — not a hypothetical enhancement.

**Context**: the architecture treats Redis as optional infrastructure — every
call site is wrapped so a Redis outage should degrade gracefully rather than
break the service (see [architecture.md](architecture.md)). This machine has
no working Redis at all (no Docker/WSL2, and Redis has no first-class Windows
build), which made it an unusually direct test of that design's actual
behavior under a real, sustained Redis outage — not just a mocked one.

**Impacted module**: `src/lib/redis.ts` (the shared ioredis client), which
`urlService.ts`'s redirect path and `rateLimit.ts`'s limiter both depend on.

**What was found**: during live end-to-end validation, a redirect request
(`GET /:code`) took **20+ seconds** to complete with Redis unreachable — long
enough that a naive client (PowerShell's `Invoke-WebRequest`, and even
`curl.exe`) appeared to hang. The redirect *did* eventually succeed by falling
back to Postgres, but a 20-second "fast path" defeats the entire purpose of
the fail-open design on what's supposed to be the hottest, latency-sensitive
route in the service.

**Root cause**: the default ioredis configuration queues commands while
disconnected (`enableOfflineQueue: true` by default) and retries the
*connection* through several reconnect backoff cycles before a queued command
finally gives up and rejects. Each application-level `try/catch` around a
Redis call was correct, but was catching the rejection only after a long
wait, not "failing open" in any timeframe useful for a hot path.

**Fix** (`src/lib/redis.ts`):

```diff
 export const redis = new Redis(env.REDIS_URL, {
-  maxRetriesPerRequest: 3,
+  enableOfflineQueue: false,
+  maxRetriesPerRequest: 1,
+  connectTimeout: 2000,
+  retryStrategy: (times) => Math.min(times * 200, 2000),
   lazyConnect: false,
 });
```

`enableOfflineQueue: false` is the load-bearing change: when the connection
isn't currently ready, a command rejects immediately instead of queueing and
waiting through reconnect attempts. This is exactly the right trade-off for a
cache/rate-limiter that must never be slower than "no cache at all."

**Validation**: re-timed the same redirect request after the fix —
**~39ms**, down from 20+ seconds, with Redis still fully unreachable. Re-ran
the full test suite (still 48/48) to confirm the change didn't regress the
cache-hit or Redis-healthy paths, which are covered by unit tests with a
mocked client.

**Trade-off accepted**: with `maxRetriesPerRequest: 1` and a fast
`retryStrategy`, a Redis connection that's merely *slow* (not down) has less
room to recover mid-command before the app-level fallback kicks in. For a
cache, that's the right call — a stale-but-correct fallback to Postgres beats
waiting. It would be the wrong call for a use case where Redis held
authoritative state.

---

## 3. Ambiguous requirement: what "reliability features" means

**Requirement (as given)**: "...core APIs, analytics, and reliability
features" — the brief names the category but not which specific mechanisms
qualify. Unlike a missing field or an unclear data type, this is ambiguous
about *scope*, and reasonable engineers could pick different, equally
defensible answers.

**Interpretations considered**:
- **Minimal**: just "don't crash on bad input" (input validation only).
- **Chosen**: a concrete, testable set — cache-aside redirect caching (Redis,
  with fail-open), collision handling on code generation, rate limiting on
  the write path, soft delete (data preservation over hard delete), a health
  endpoint, and graceful shutdown.
- **Maximal**: the above plus circuit breakers, retries-with-backoff on the
  database itself, multi-region failover, structured audit logging — all
  reasonable in a real production system, but disproportionate for a 2-3 day
  prototype and not clearly implied by the brief.

**Why the middle option**: each item in the chosen set maps to a specific,
demonstrable failure mode this service can actually hit (cache down, code
collision, abusive client, accidental data loss on delete, orchestrator
health checks, in-flight requests during a deploy) — and each one is small
enough to actually implement, test, and validate live within scope, which
matches "engineering judgment" better than either extreme. The minimal
interpretation would leave the assignment's explicit word "reliability"
unaddressed; the maximal one would spend the session's time budget on
mechanisms with no corresponding failure mode demonstrated in this system.

**Documented, not built**: multi-instance cache consistency testing,
authentication/authorization, and circuit breakers around the database are
called out as explicit gaps in [engineering-summary.md](engineering-summary.md)
rather than silently out of scope.
