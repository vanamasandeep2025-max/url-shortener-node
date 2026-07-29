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
line-by-line code reading — and that gate caught six genuine defects the
AI's own first pass had introduced and its own written tests had not caught:

| # | Defect | How it was found | Fix |
|---|---|---|---|
| 1 | `POST /api/urls` always returned `400`. The Zod schema's field is `url`, but the route passed `req.body` straight through to `createShortUrl`, which expects `longUrl`. | A live `curl` request during end-to-end validation (unit tests mocked the service layer directly, so they never exercised this route-to-service mapping). | Route now explicitly maps `body.url → longUrl` ([src/routes/urls.ts](../src/routes/urls.ts)). |
| 2 | Redirect requests took 20s+ to fail over to Postgres when Redis was unreachable — the opposite of the intended fail-open design. | Timed a live redirect request against a real (down) Redis; the delay was long enough that a naive `curl` even appeared to hang. | `enableOfflineQueue: false` + tighter `maxRetriesPerRequest`/`retryStrategy` on the ioredis client ([src/lib/redis.ts](../src/lib/redis.ts)) — Redis commands now reject in milliseconds instead of queuing through reconnect backoff. Verified: redirect now resolves in ~39ms with Redis down. This is written up in full as the brownfield scenario in [scenarios.md](scenarios.md). |
| 3 | Malformed request JSON produced a `500` instead of a `400`. `express.json()`/body-parser attaches `status`/`statusCode` to its `SyntaxError`, but the error handler only special-cased the app's own `AppError` hierarchy, so this fell through to the generic 500 branch and was logged as an "unhandled error". | Found while investigating an unrelated PowerShell/curl quoting bug in a manual test — the malformed-JSON path the quoting bug accidentally exercised returned the wrong status. | `errorHandler` now recognizes any `Error` with a numeric `status`/`statusCode` in the 4xx range and returns that status instead of falling through to 500 ([src/middleware/errorHandler.ts](../src/middleware/errorHandler.ts)). Added a regression test for it. |
| 4 | `GET /api/urls?includeInactive=false` still returned soft-deleted links — the literal string `"false"` was being coerced to `true`. | Noticed the risk while building the manual test UI (which calls this endpoint), then confirmed it live: created a link, soft-deleted it, and queried with `includeInactive=false`, which incorrectly returned it. | `z.coerce.boolean()` runs `Boolean(str)`, and `Boolean("false")` is `true` — a well-known Zod footgun. Replaced with an explicit `z.enum(["true","false"]).transform(v => v === "true")` ([src/routes/urls.ts](../src/routes/urls.ts)). Added a regression test. |
| 5 | Stored XSS in the manual test UI: `longUrl` (only checked for a valid `http(s)` scheme, never HTML-sanitized) and click `referrer`/`user-agent` (raw, fully attacker-controlled request headers) were interpolated straight into `innerHTML` when the dashboard was redesigned. | Self-caught during the redesign, before shipping it: confirmed exploitable by `POST`-ing `{"url":"https://example.com/\"><img src=x onerror=alert(1)>"}` and observing the API accept and store it verbatim (the URL validator checks `new URL()` parses and the scheme is allowed, not that the string is free of HTML-breaking characters). | Added an `escapeHtml()` helper in [public/app.js](../public/app.js) and applied it to every value from the API before it's placed in `innerHTML` (`longUrl`, `code`, `shortUrl`, `referrer`, `userAgent`). The API itself still stores the raw URL (needed for exact redirects); the fix is encode-on-output in the UI, not mangling stored data. |
| 6 | Password-protected links: entering the correct password appeared to do nothing — the browser never navigated to the destination. Reported live by the engineer against a real external URL, after an earlier Playwright test had hit the identical symptom and been (wrongly) attributed to test-environment flakiness rather than an app bug — see the full corrected account below. | Server request log showed a correct `302`/`Location`/`Set-Cookie` every time; the actual cause was Helmet's default CSP `form-action 'self'`, which blocks a *form submission's resulting redirect* from crossing origins, confirmed by inspecting the `Content-Security-Policy` response header directly. | Widened `form-action` to `'self' https: http:` in [src/app.ts](../src/app.ts) — intentional, since this app's product is redirecting to arbitrary http(s) URLs by design. Verified with a real Playwright-driven Chrome session navigating through to a genuine cross-origin destination, not just curl (curl doesn't enforce CSP, so it couldn't have caught this). |

Each fix was re-verified by rerunning the full test suite (`npx jest`, 71/71
passing throughout, plus 19/19 Playwright — defect #5 is client-side JS with no automated test
harness in this project, so it was verified manually instead, see below) and
repeating the live `curl`/browser walkthrough — not accepted on the strength
of the diff alone.

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
- `npx jest` (unit + integration) — 71/71 passing as of the final commit.
- `npx playwright test` — 19/19 passing as of the final commit.
- Live server run + manual `curl`/`Invoke-RestMethod` walkthrough of every
  endpoint, including the rate limiter and a genuinely-unreachable Redis.
- A minimal manual test UI (`public/`, served at `/ui`) was built on request
  so the API could be exercised from a real browser rather than only via
  curl. The engineer used it directly (create → redirect → stats worked
  first try); building it is also what prompted the review that found defect
  #4 above, since the UI calls `includeInactive` as a literal query string.
- **Playwright end-to-end suite** (`tests/e2e/`, `npm run test:e2e`), added on
  request to cover the dashboard from a real browser: 16 tests across create
  flows, validation/conflict errors, list/delete/toggle, click tracking
  through to the Details view, copy-to-clipboard, the stored-XSS regression
  (#5), and rate limiting. First run surfaced two problems in the
  AI-generated *tests themselves* (not the app) — logged here because
  "traceability" means showing what was wrong and corrected, not just what
  ended up passing:
  - A "malformed alias → server error" test assumed a server round-trip, but
    the alias input's HTML `pattern` attribute (mirroring the server rule)
    made the browser block submission before any request was sent. Fixed by
    explicitly removing the attribute to exercise server-side validation, and
    added a second test asserting the client-side block itself as its own
    scenario, rather than deleting the coverage gap.
  - The stored-XSS regression test asserted against the table cell's visible
    (45-char-truncated) text, which cut the payload short and made a correct
    fix look like a failure. Fixed by asserting against the `title` attribute,
    which always holds the untruncated escaped value.
  - The rate-limit test runs against its own isolated server instance
    (`RATE_LIMIT_POINTS=3`, a separate port) specifically so it can't
    interfere with, or be interfered by, every other test's quota usage on
    the shared per-IP limiter — a design decision made before writing the
    test, not a fix after the fact.
- **Brought up a real Redis instance on request**, to validate both use
  cases (cache-aside redirects, rate limiting) against genuine Redis rather
  than a mock or its absence. Docker was still unavailable; Memurai (the
  standard commercial option for Redis-on-Windows) was tried first and
  failed with an MSI custom-action error ("failed to create temp directory",
  unrelated to this project) — rather than spend more time fighting that
  installer, switched to a portable community build of real upstream Redis
  8.8 for Windows (`taizod1024/redis-windows`), which needed no installer at
  all. Both use cases were then verified directly, not inferred: `redis-cli
  GET shortUrl:<code>` showed the exact cached JSON and TTL after a redirect;
  `redis-cli GET rl:create:<ip>` showed the real atomic counter climbing
  and the 429 tripping at the configured threshold. This also surfaced a
  latent test-isolation gap: the Playwright suite's two server instances
  (the general "app" project and the dedicated "rate-limit" project) both
  pointed at the same Redis with no per-project key separation, which had
  been invisible while Redis was absent (each fell back independently to
  its own in-memory limiter) but would have made the rate-limit test flaky
  once a real, shared Redis was involved. Fixed by giving each project its
  own Redis logical DB (`/0` and `/1`) in `playwright.config.ts`.
- **Password protection for links**, added on request after comparing this
  app against a reference URL-shortener site (urlshort.dev) and confirming
  scope directly with the engineer rather than guessing which of that site's
  features ("Custom Link", "Set Expiration", "Password Protection", "Generate
  QR Code", full campaign/analytics tooling) were actually in scope — only
  password protection was requested; the rest was explicitly declined.
  Implementation: `password_hash` column (bcrypt, cost 10), a `hasPassword`
  boolean on the public DTO (the hash itself is never returned, never cached
  in Redis, and re-read fresh from Postgres on every unlock attempt), a
  stateless HMAC-signed cookie for "already unlocked" (no session table), a
  plain-HTML unlock form (works without JavaScript), and its own rate limiter
  keyed by IP+code so brute-forcing one link's password can't be masked by,
  or drown out, traffic to any other link.
  - **A test failure was initially misdiagnosed, then correctly root-caused
    after a real user hit the same bug live** — logged in full because the
    correction matters as much as the original finding. A Playwright test
    submitting the correct password after a wrong one appeared to never
    redirect. First investigation used the *server's own request log* (not
    guesswork) and confirmed the server was always returning `302` with the
    right `Location` and `Set-Cookie` in ~150ms, reproducible identically via
    curl. **That part of the diagnosis was correct.** But the conclusion drawn
    from it — "redirect-driven cross-origin navigation to `page.route()`
    stubs isn't reliably intercepted in this environment" — was wrong, and
    was accepted too quickly because the workaround (pointing the test's
    destination at the app's own origin) made the test pass. The real cause
    surfaced only when the engineer reported the identical symptom against a
    real external destination in a real browser (not a test): Helmet's
    default Content-Security-Policy sets `form-action 'self'`, which restricts
    not just where a `<form>` can submit, but **the final destination after
    any server-side redirect that submission triggers** — so the browser was
    silently refusing to follow the unlock form's redirect to any
    cross-origin URL, exactly matching "server responds correctly, browser
    visibly does nothing." Confirmed via the CSP header on the response
    itself, then fixed in `src/app.ts` by widening `form-action` to allow
    `http:`/`https:` — an intentional relaxation, not a weakening, since this
    app's entire product is redirecting to arbitrary http(s) URLs by design
    (see engineering-summary.md's "Open redirect by design" note). The
    Playwright test was reverted to use a genuine cross-origin destination
    (with `page.route()` stubbing, which was never actually the problem) so
    it once again catches a regression of the real bug — the earlier
    same-origin version would never have caught it. **Lesson**: a workaround
    that makes a test pass is not the same as a root cause, and should be
    labeled as "test now passes" rather than "bug understood" until the
    mechanism is actually confirmed (here, by reading the CSP header) rather
    than merely no-longer-triggered.

## Limitations of this traceability record

This was a single-engineer, single-AI-assistant session — there was no
second human reviewer, and "review" meant the engineer directing scope and
the assistant validating behavior by execution, not a line-by-line code
review by a second party. That's an appropriate process for a 2-3 day
prototype, but is explicitly not the same as a team code-review gate, and is
called out here rather than implied away.
