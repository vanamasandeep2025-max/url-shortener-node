# AI Usage Log

This session used Claude Code (Claude, Anthropic) as a pair-programming
assistant under direct engineer (Sandeep Vanama) oversight: the engineer set
direction and approved every consequential decision; the assistant executed
within those bounds and reported findings rather than deciding unilaterally.
This log records the decisions that mattered, in the order they happened, and
is honest about what was AI-generated vs. engineer-directed vs. found by
actually running the code.

## Direction-setting decisions (engineer-approved before any code was written)

1. **Discovered pre-existing work instead of ignoring it.** Before writing
   anything, the assistant inspected the working directory and found an
   untested Spring Boot + React attempt at this same assignment. Rather than
   silently building alongside or over it, this was surfaced to the engineer
   with its actual state (never compiled/run) as context. **Engineer decided**:
   start fresh with Node/TypeScript/Express/Postgres/Redis instead of
   continuing that codebase.
2. **Environment blockers surfaced, not silently worked around.** The
   assistant found no git/Java/Node/npm and a non-functional Docker daemon
   (root-caused to "no WSL2 distro installed"), and that fixing Docker
   properly needed admin elevation this session doesn't have. Rather than
   either stalling or quietly downgrading the validation story, this was
   presented as an explicit choice. **Engineer decided**: install git/Node via
   winget, and use a natively-installed Postgres instead of Docker for local
   Postgres, with Redis mocked/unit-tested rather than run for real.
3. **Feature depth and stack** were fixed by the engineer via direct
   questions before implementation began (Node/TS/Express/Postgres/Redis;
   core APIs + analytics + reliability, not core-only).

## What was AI-generated, and what caught problems in it

All application code (`src/`), tests (`tests/`), config, and this
documentation set were AI-generated in an initial pass based on the plan
above. The engineer's review gate was **running it for real**, not
line-by-line code reading — and that gate caught three genuine defects the
AI's own first pass had introduced and its own written tests had not caught:

| # | Defect | How it was found | Fix |
|---|---|---|---|
| 1 | `POST /api/urls` always returned `400`. The Zod schema's field is `url`, but the route passed `req.body` straight through to `createShortUrl`, which expects `longUrl`. | A live `curl` request during end-to-end validation (unit tests mocked the service layer directly, so they never exercised this route-to-service mapping). | Route now explicitly maps `body.url → longUrl` ([src/routes/urls.ts](../src/routes/urls.ts)). |
| 2 | Redirect requests took 20s+ to fail over to Postgres when Redis was unreachable — the opposite of the intended fail-open design. | Timed a live redirect request against a real (down) Redis; the delay was long enough that a naive `curl` even appeared to hang. | `enableOfflineQueue: false` + tighter `maxRetriesPerRequest`/`retryStrategy` on the ioredis client ([src/lib/redis.ts](../src/lib/redis.ts)) — Redis commands now reject in milliseconds instead of queuing through reconnect backoff. Verified: redirect now resolves in ~39ms with Redis down. This is written up in full as the brownfield scenario in [scenarios.md](scenarios.md). |
| 3 | Malformed request JSON produced a `500` instead of a `400`. `express.json()`/body-parser attaches `status`/`statusCode` to its `SyntaxError`, but the error handler only special-cased the app's own `AppError` hierarchy, so this fell through to the generic 500 branch and was logged as an "unhandled error". | Found while investigating an unrelated PowerShell/curl quoting bug in a manual test — the malformed-JSON path the quoting bug accidentally exercised returned the wrong status. | `errorHandler` now recognizes any `Error` with a numeric `status`/`statusCode` in the 4xx range and returns that status instead of falling through to 500 ([src/middleware/errorHandler.ts](../src/middleware/errorHandler.ts)). Added a regression test for it. |

Each fix was re-verified by rerunning the full test suite (`npx jest`, 48/48
passing after all three fixes) and repeating the live `curl` walkthrough —
not accepted on the strength of the diff alone.

## Design choices proposed by AI and accepted as-is

- Random Base62 short codes with bounded collision-retry, instead of
  `base62(id)` (which the prior Java attempt at this brief used) — chosen
  specifically to exercise real collision handling and avoid sequentially
  guessable codes.
- Soft delete over hard delete, async best-effort click recording, cache as
  optional infrastructure everywhere it's touched (see
  [architecture.md](architecture.md) for rationale on each).
- Hand-written initial Prisma migration instead of generating one from a live
  `prisma migrate dev` session, so schema setup doesn't depend on DB
  availability at generation time.

## Quality gates actually run (not just planned)

- `npx tsc --noEmit` — caught and fixed one route-typing issue (dynamic
  Express route param couldn't be inferred; fixed with an explicit generic).
- `npx eslint` — caught and fixed a `no-require-imports` violation in a test
  file (rewritten to use static imports with `jest.mock` hoisting).
- `npx jest` (unit + integration) — 48/48 passing as of the final commit.
- Live server run + manual `curl`/`Invoke-RestMethod` walkthrough of every
  endpoint, including the rate limiter and a genuinely-unreachable Redis.

## Limitations of this traceability record

This was a single-engineer, single-AI-assistant session — there was no
second human reviewer, and "review" meant the engineer directing scope and
the assistant validating behavior by execution, not a line-by-line code
review by a second party. That's an appropriate process for a 2-3 day
prototype, but is explicitly not the same as a team code-review gate, and is
called out here rather than implied away.
