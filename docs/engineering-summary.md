# Engineering Summary

## What was built

A URL shortener: Express/TypeScript REST API, PostgreSQL storage (via
Prisma), Redis-backed redirect caching and rate limiting (both designed to
fail open), click analytics, and Docker artifacts for deployment. See
[architecture.md](architecture.md) for component/flow diagrams and
[database-schema.md](database-schema.md) for the data model.

## Assumptions made (requirement was silent or ambiguous on these points)

- **Code alphabet/length**: not specified → random Base62, 7 characters
  (`62^7 ≈ 3.5×10^12` combinations), with collision retry. See
  [scenarios.md](scenarios.md) for why this was chosen over a simpler
  id-derived code.
- **Custom aliases**: not explicitly requested, but a natural extension of
  "core APIs" → built, with 409 on collision.
- **Expiration**: not mentioned in the brief at all → made optional
  (`expiresAt`, nullable, must be in the future if provided), defaulting to
  "never expires."
- **Analytics granularity**: "analytics" interpreted as total click count +
  a bounded, paginated recent-events feed (timestamp, referrer, user-agent) —
  not raw event export or time-bucketed rollups, which would need a retention
  policy and aggregation jobs not justified at prototype scale.
- **Reliability feature scope**: see the ambiguous-requirement write-up in
  [scenarios.md](scenarios.md) — cache-aside caching, collision handling,
  rate limiting, soft delete, health checks, graceful shutdown; explicitly
  not circuit breakers, retries-with-backoff on Postgres itself, or
  multi-region failover.
- **Multi-tenancy/auth**: not mentioned → none built. Every link is globally
  readable/listable/deletable by code. This is a real gap for anything beyond
  a prototype, flagged here rather than silently accepted.

## Risks and edge cases

- **No authentication/authorization.** Anyone who knows or guesses a code can
  view its stats or delete it. Acceptable for a prototype; not for production.
- **Rate limiting is per-IP, not per-account** (there are no accounts). A
  distributed abuser behind many IPs isn't meaningfully slowed down.
- **Open redirect by design.** The service redirects to any `http(s)` URL a
  caller submits — that's the product. If ever embedded behind a trusted
  domain, that trust could be abused for phishing; a production version
  should consider a denylist or click-through interstitial.
- **Click tracking is best-effort, not exactly-once.** A crash between
  "redirect sent" and "click event committed" undercounts. Fine for
  analytics; not for anything billing-relevant.
- **`expiresAt` is checked, not enforced by deletion.** Expired rows remain
  (no cleanup job) so their click history stays queryable — intentional, but
  worth stating so it isn't mistaken for a bug.
- **Redis fail-open latency** was a real bug found and fixed in this session
  (see [scenarios.md](scenarios.md)) — flagged here as a reminder that
  "designed to fail open" and "actually fails open fast" are different
  claims, and only one of them was true until it was measured.

## Performance considerations

- The redirect path is the hot path and the only cached read; a cache hit
  needs zero Postgres queries (the cache entry carries the numeric id, not
  just the long URL, specifically so a hit never needs a follow-up DB lookup).
- `click_events` is indexed on `short_url_id`, so click writes don't
  contend with `short_urls` reads, and `/stats` reads use the index rather
  than a full table scan.
- List/stats endpoints are paginated (`limit`/`offset`, capped at 100) from
  the start, not added later as a fix.

## Security considerations

- URL validation restricts creation to well-formed `http`/`https` URLs,
  rejecting `javascript:`/`data:`/`file:` schemes.
- Request bodies are validated at the Zod boundary before reaching business
  logic; body size is capped (`10kb`) to limit trivial abuse.
- `helmet` (secure headers) and CORS scoped to configured origins, not
  wide open.
- Client IPs are hashed (SHA-256, truncated) before storage, not stored raw.
- No secrets are hardcoded; DB/Redis credentials come from environment
  variables (`.env`, not committed — see `.gitignore`).
- **Stored data is not HTML-safe by construction.** `longUrl` is validated as
  a well-formed `http(s)` URL but not sanitized against HTML-breaking
  characters, and click `referrer`/`user-agent` are raw request headers with
  no validation at all. The manual test UI (`public/app.js`) escapes all of
  these before rendering — encode-on-output, since the API must keep the
  exact stored URL for correct redirects. Any future UI/consumer of this data
  (including a real admin dashboard) must do the same; this is not enforced
  by the API itself.
- Not addressed, and explicitly out of scope for this prototype rather than
  an oversight: authentication, authorization, audit logging, a redirect
  denylist.

## Trade-offs

| Decision | Trade-off accepted |
|---|---|
| Random code + collision retry | Slightly more code and a (vanishingly rare) generation-failure path, in exchange for non-guessable codes and demonstrable collision handling. |
| Native PostgreSQL for Windows instead of Docker | Real integration tests and a real live run were possible without a working Docker/WSL2 setup, at the cost of the actual deployment topology (`docker-compose.yml`) being untested in this environment. |
| `ioredis-mock` for integration tests, no real Redis at all | Tests run without any Redis installation, at the cost of not validating actual Redis wire-protocol behavior (Lua scripting for the rate limiter, real network failure modes) — only the app's handling of success/error responses from a Redis-shaped client. |
| `enableOfflineQueue: false` on the Redis client | Fast, predictable fail-open on a hard outage, at the cost of less tolerance for a merely-slow-but-recovering Redis mid-command (see [scenarios.md](scenarios.md)). |
| Soft delete, no hard-delete path | Preserves analytics history, at the cost of `short_urls` growing unboundedly (no archival/purge job). |

## Validation approach

- **Static**: `tsc --noEmit` (clean), `eslint` (clean after one fix — see
  [ai-usage-log.md](ai-usage-log.md)).
- **Unit**: 34 tests, Jest, fully mocked Prisma/Redis — covers code
  generation/collision retry, URL validation, and every branch of the service
  layer (happy path, expiry, soft delete, cache hit/miss, Redis failure).
- **Integration**: 15 tests, Supertest against the real Express app, a real
  local PostgreSQL database, and `ioredis-mock` — exercises every endpoint's
  success and error paths (400/404/409/410) through an actual database, with
  data reset between tests.
- **Live**: the compiled server, run for real and driven with `curl`/
  `Invoke-RestMethod` through every endpoint, the rate limiter, and the
  redirect path with Redis genuinely unreachable. This step — not the
  automated suite — is what found the three API-level bugs logged in
  [ai-usage-log.md](ai-usage-log.md).
- **Browser**: a minimal manual test UI (`public/`, served at `/ui`) was
  added on request so the API could be driven from a real browser instead of
  only curl. Used directly in a real browser session (create → redirect →
  stats all confirmed working); building it also prompted the review that
  caught the fourth bug (`includeInactive=false` being coerced to `true`).
- **Not done, and stated plainly rather than implied**: `docker compose up
  --build` was never executed (see [architecture.md](architecture.md)'s
  Known Limitations); Redis's actual behavior under real network conditions
  (not a mock) was never observed; there is no load/soak test.

## Lessons learned

- Actually running the code — not just writing tests for it — is what caught
  every real bug in this session. All three were invisible to a first read of
  the diff and two were invisible to the unit test suite as originally
  written, because they lived exactly at the seams the mocks stood in for
  (route→service field mapping, and real vs. mocked Redis timing behavior).
- Surfacing environment blockers (missing tools, a broken Docker daemon,
  pre-existing work) as explicit decisions for the engineer, instead of
  quietly working around or ignoring them, kept the session aligned with
  what the engineer actually wanted rather than what was locally convenient.
- "Designed to fail open" is a claim about intent; only measuring actual
  latency under a real outage turns it into a claim about behavior. The Redis
  latency bug would have shipped in a session that stopped at "the try/catch
  is there."
