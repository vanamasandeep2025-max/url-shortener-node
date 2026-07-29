# Architecture

## Components

```
                      ┌──────────────────────┐
                      │   Express API (TS)   │
                      │  routes → middleware │
                      │      → services      │
                      └──────────┬───────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 ▼                               ▼
      ┌────────────────────┐          ┌─────────────────────┐
      │     PostgreSQL      │          │        Redis         │
      │ source of truth:    │          │ optional accelerator: │
      │ short_urls,         │          │ redirect cache-aside, │
      │ click_events        │          │ distributed rate limit│
      └────────────────────┘          └─────────────────────┘
```

- **Express API** — TypeScript, organized as `routes/` (HTTP concerns) →
  `middleware/` (cross-cutting: validation, rate limiting, error mapping) →
  `services/` (business logic, the only layer that talks to Postgres/Redis).
- **PostgreSQL** — the only source of truth. Every read the API can serve
  correctly, it can serve directly from Postgres alone.
- **Redis** — cache-aside for the redirect hot path, and the backing store
  for distributed rate limiting. Deliberately **not** a hard dependency: every
  Redis call is wrapped so a Redis outage degrades performance (extra DB
  reads, rate limiting falls back to a per-process in-memory limiter), never
  availability. This was validated for real, not just designed on paper — see
  [Known limitations](#known-limitations-of-this-environment) and
  [scenarios.md](scenarios.md)'s brownfield example, which is exactly a bug
  found in this fail-open path.

## Request flows

**Create** (`POST /api/urls`)
```
client → rate limiter → Zod body validation → urlService.createShortUrl
       → (custom alias: validate pattern, insert, 409 on collision)
       → (no alias: generate random Base62 code, insert,
          retry on collision up to 5x, 503 if exhausted)
       → 201 { code, shortUrl, longUrl, createdAt, expiresAt, isActive }
```

**Redirect** (`GET /:code`)
```
client → urlService.getRedirectTarget
       → Redis GET shortUrl:{code}  (cache hit → skip DB entirely)
       → on miss/error: Postgres findUnique → populate cache
       → 404 if missing, 410 if soft-deleted or expired
       → hasPassword && no valid unlock_{code} cookie?
             → 200 HTML password prompt (no redirect, no click recorded)
       → 302 to longUrl
       → (fire-and-forget, does not block the response) record click:
         shortUrlId, referrer, hashed IP, user-agent → Postgres
```

**Unlock** (`POST /:code/unlock`, password-protected links only)
```
client → unlock rate limiter (per IP+code, independent of the create limiter)
       → urlService.verifyLinkPassword: fresh Postgres read (never cached --
         the password hash never enters Redis), bcrypt.compare
       → wrong → 401, re-render the prompt page with an error
       → correct → sign a short-lived HMAC token, Set-Cookie unlock_{code}
                   (HttpOnly, Path=/{code}, default 1h TTL)
                → same as a normal redirect: record click, 302 to longUrl
```

**Stats / List / Delete** — straightforward reads/writes against Postgres;
delete is a soft delete (`isActive = false`) that also invalidates the Redis
cache entry for that code, so a deleted link doesn't keep redirecting from a
stale cache entry until TTL expiry.

## Key decisions

| Decision | Rationale |
|---|---|
| Random Base62 code + bounded collision retry, not `base62(id)` | The id-based approach used in a prior attempt at this same brief is collision-free by construction but makes codes sequentially guessable (`/1`, `/2`, ...). Random generation plus retry-on-collision is slightly more code but demonstrates genuine collision handling and isn't enumerable. |
| Cache-aside Redis, not write-through | Redirects (reads) dominate traffic in a URL shortener; cache-aside keeps Postgres as the single source of truth and only optimizes the hot read path. |
| Redis is optional infrastructure everywhere it's touched | A cache or rate limiter that can take the whole service down when *it* fails is worse than not having one. Every Redis call site fails open (see `urlService.ts`, `rateLimit.ts`, `redis.ts`). |
| Soft delete (`isActive`), not row deletion | Preserves click-history analytics for a link after it's "deleted" — matches how the prior Java attempt at this brief reasoned about it, and avoids losing analytics data on delete. |
| Async, best-effort click recording | A slow or failing analytics write must never delay or fail the redirect itself, which is the actual product behavior users depend on. |
| Zod at the HTTP boundary, plain functions for domain rules | Zod checks request *shape* (types, required fields); `urlService`/`urlValidator` check *domain* rules (URL scheme, alias charset, expiry-in-the-future). Keeping these separate avoids duplicating validation logic in two different languages (schema vs code). |
| Centralized `AppError` hierarchy + one error-handling middleware | Every route throws a typed error (`NotFoundError`, `ConflictError`, ...) and a single middleware maps it to the right HTTP status and a consistent `{ error: { message, code } }` body, instead of each route hand-rolling status codes. |
| Password hash never enters the Redis cache | The redirect cache entry carries a `hasPassword` boolean, not the hash itself. Verifying a password attempt (`verifyLinkPassword`) always re-reads Postgres directly. This keeps a rare, security-sensitive path off the hot-path cache entirely, at the cost of one extra query per unlock attempt (never per redirect). |
| Stateless signed cookie for "already unlocked", not a session table | `unlockToken.ts` HMAC-signs `code + expiry` and verifies it with a timing-safe comparison — no server-side session store needed, and the token is inherently scoped to one code since the code is part of the signed payload. |
| Plain HTML `<form>` for the unlock prompt, not a JS-driven flow | Works even with JavaScript disabled; keeps the password-entry UX resilient and simple, consistent with the rest of the dashboard's "progressively enhanced, not JS-required" posture for anything safety-critical. |

## Known limitations of this environment

This machine had no Docker/WSL2, Java, Node, or git installed at the start of
this session (only Docker was present, and its Linux backend couldn't start —
no WSL2 distro). Git and Node were installed via `winget`; PostgreSQL was
installed natively for Windows (also via `winget`) so real integration tests
and a real end-to-end run were possible without Docker. Getting WSL2/Hyper-V
working would need admin elevation and likely a reboot, which wasn't pursued
in this session (see [engineering-summary.md](engineering-summary.md)).

Practical effect:
- **Dockerfile and docker-compose.yml are provided** and represent the
  intended deployment path, but were **not executed** in this environment —
  they're reasoned-through, not observed-passing, the same caveat the prior
  Java attempt at this brief flagged for its entire codebase.
- **Integration tests run against a real, natively-installed PostgreSQL**
  (not Testcontainers, which needs Docker) — this part *is* observed-passing.
- **Redis was initially unavailable** (no Docker, and Redis has no official
  Windows build). Its client code was first validated three ways instead:
  unit tests with a mocked client, integration tests via `ioredis-mock`, and
  a live run of the compiled server against a real-but-unreachable Redis
  URL — which is what surfaced the fail-open latency bug documented in
  [scenarios.md](scenarios.md). **A genuine Redis instance was later brought
  up** via a portable community Windows build (`taizod1024/redis-windows`,
  real upstream Redis 8.8 compiled for Windows/MSYS2 — Memurai, the more
  common commercial alternative, failed to install in this environment due
  to an unrelated MSI installer defect). With real Redis running, both use
  cases were re-verified directly against it: the redirect cache-aside entry
  (`shortUrl:<code>`, correct TTL) and the rate limiter's atomic counter
  (`rl:create:<ip>`) were both inspected live via `redis-cli`, not inferred.
  The already-running server picked up the connection automatically via
  ioredis's built-in reconnect logic, with no restart needed — itself a
  small proof that the fail-open/reconnect design works as intended.
