# URL Shortener (Node/TypeScript)

A URL shortener prototype: Express + TypeScript REST API, PostgreSQL storage
(via Prisma), Redis-backed redirect caching and rate limiting (both designed
to fail open if Redis is unavailable), click analytics, and Docker artifacts
for deployment.

> **Note on validation in this environment**: this machine had no working
> Docker/WSL2, so `docker compose up --build` has **not** been executed here
> — the Dockerfile/docker-compose.yml represent the intended deployment path
> but are untested in this session. Everything else *was* actually run: the
> full backend test suite (71/71 passing) against a real, natively-installed
> PostgreSQL, a 19-test Playwright suite driving a real browser against the
> dashboard, plus a live server run driven with real `curl` requests through
> every endpoint (including a real Redis instance for the caching and
> rate-limiting paths — see below). See [docs/architecture.md](docs/architecture.md#known-limitations-of-this-environment)
> and [docs/ai-usage-log.md](docs/ai-usage-log.md) for exactly what was and
> wasn't verified, including six real bugs this validation found and fixed
> (three API-level, one Zod query-param footgun, one stored-XSS finding, and
> one Playwright test-flakiness root-caused to a browser networking quirk,
> not the app).

## Features

- Create a short URL from any `http(s)` long URL, with an optional custom
  alias, an optional expiry, and an optional **password** (bcrypt-hashed,
  never stored or returned in plaintext).
- Redirect short → long URL (`302`), with Redis cache-aside on the hot path
  and a fast fail-open to Postgres if Redis is down. A password-protected
  link instead shows a small unlock page (plain HTML form, works without
  JavaScript); a short-lived signed cookie remembers a successful unlock so
  the visitor isn't re-prompted on every click.
- Click analytics: total clicks + paginated recent click events (timestamp,
  referrer, user-agent).
- Reliability: collision-checked code generation, Redis-backed rate limiting
  on both link creation and password attempts (with an in-memory fallback if
  Redis is unavailable), soft delete, health endpoint, graceful shutdown.
- Consistent JSON error responses with correct HTTP status codes.

## Project layout

```
src/          Express app: routes/ → middleware/ → services/, lib/ (Prisma, Redis, env, logger)
prisma/       Schema + hand-written initial migration
tests/        unit/ (mocked deps) and integration/ (real Postgres, mocked Redis)
docs/         Architecture, DB schema, API docs, task breakdown, AI usage log, scenarios, engineering summary
docker-compose.yml, Dockerfile   Intended deployment path (see note above)
```

## Prerequisites

- **Docker path** (untested in this session, but intended to work):
  Docker + Docker Compose.
- **Local dev path** (what was actually used and verified here): Node.js 20+,
  a running PostgreSQL 16 instance, and optionally Redis 7 (the app runs
  correctly, in a degraded/no-cache mode, without Redis).

## Run with Docker Compose

```bash
docker compose up --build
```
- API: http://localhost:3000

This starts Postgres, Redis, and the API together; the API container runs
`prisma migrate deploy` on startup.

## Run locally (verified path)

1. Start PostgreSQL and create a database/role matching `.env.example`
   (defaults: db `urlshortener`, user/password `urlshortener`), e.g.:
   ```sql
   CREATE ROLE urlshortener LOGIN PASSWORD 'urlshortener';
   CREATE DATABASE urlshortener OWNER urlshortener;
   CREATE DATABASE urlshortener_test OWNER urlshortener; -- for integration tests
   ```
2. Copy the env file and adjust if needed:
   ```bash
   cp .env.example .env
   ```
3. Install dependencies and generate the Prisma client:
   ```bash
   npm install
   npx prisma generate
   npx prisma migrate deploy
   ```
4. Build and run:
   ```bash
   npm run build
   npm start
   ```
   Or for development with auto-reload: `npm run dev`.

Redis is optional for local dev — if `REDIS_URL` points to nothing running,
the app logs a connection warning and continues serving correctly (cache
misses fall through to Postgres; rate limiting falls back to an in-memory
limiter). See [docs/architecture.md](docs/architecture.md) for why this is a
deliberate design, not an accident.

To run against a **real** Redis on Windows without Docker (e.g. to see the
cache-aside entries or rate-limit counters yourself via `redis-cli`), install
a portable build — no service/installer required:
```powershell
winget install --id taizod1024.redis-windows-fork -e
# then, from the extracted folder (winget prints the path):
.\redis-server.exe --port 6379
```
The app will pick it up automatically (`ioredis` reconnects on its own — no
app restart needed) since `.env.example` already points `REDIS_URL` at
`redis://localhost:6379`.

## Manual test UI

Once the server is running, open **http://localhost:3000/ui/** for a minimal
browser page to shorten URLs, follow the short link, view click stats, and
soft-delete links — a quick way to exercise the API without hand-writing
curl commands. It's a thin client over the same `/api/urls` endpoints
documented below (see `public/index.html` and `public/app.js`); it is not
part of the production API surface.

## Running tests

```bash
npm run test:unit         # 50 tests, fully mocked, no infra needed
npm run test:integration  # 21 tests, needs a running Postgres pointed at by DATABASE_URL
npm test                  # both (71 tests)
npm run test:e2e          # 19 Playwright tests, drives a real browser against the real app
```

Integration tests use `ioredis-mock` in place of a real Redis client (see
[docs/engineering-summary.md](docs/engineering-summary.md) for why), and
truncate the `short_urls`/`click_events` tables between tests.

### End-to-end (Playwright)

`npm run test:e2e` builds the project, spins up two real server instances
(handled automatically by Playwright's `webServer` config — no manual setup),
and drives an actual Chromium browser against the dashboard at `/ui`. It needs
`urlshortener_test` migrated (same prerequisite as `test:integration`) and
`npx playwright install chromium` run once beforehand.

Covers: creating links (random code, custom alias, expiry), client- and
server-side validation errors, alias conflicts, the empty state, delete +
"Show deleted" toggle (including a regression guard for the
`includeInactive` coercion bug), click tracking end-to-end through the
redirect into the Details view, copy-to-clipboard, a stored-XSS regression
test (malicious `longUrl` and malicious `referrer`/`user-agent`),
password-protected links (prompt → wrong password → correct password →
remembered via cookie), and rate limiting — the last one runs against its
own isolated server instance (`RATE_LIMIT_POINTS=3`) so it can't starve, or
be starved by, any other test's quota. See [docs/scenarios.md](docs/scenarios.md)
and [docs/ai-usage-log.md](docs/ai-usage-log.md) for how this suite was built
and what it caught.

## API quick reference

```bash
# Create a short URL
curl -X POST http://localhost:3000/api/urls \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/a/very/long/path"}'

# Create a password-protected short URL
curl -X POST http://localhost:3000/api/urls \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/secret", "password": "letmein123"}'

# Follow it
curl -i http://localhost:3000/<code>

# Unlock a password-protected one (form-encoded, matches the HTML prompt page)
curl -i -X POST http://localhost:3000/<code>/unlock --data "password=letmein123"

# Check analytics
curl http://localhost:3000/api/urls/<code>/stats

# Health check
curl http://localhost:3000/health
```

Full endpoint reference: [docs/api-documentation.md](docs/api-documentation.md).

## Documentation

- [Architecture](docs/architecture.md) — components, request flows, key
  decisions, known limitations of this environment.
- [Database schema](docs/database-schema.md) — ER diagram and column
  reference.
- [API documentation](docs/api-documentation.md) — full endpoint reference.
- [Task breakdown](docs/task-breakdown.md) — how the work was decomposed and
  sequenced, including two environment-driven detours.
- [AI usage log](docs/ai-usage-log.md) — what was AI-generated, what the
  engineer decided, and five real bugs found by live/automated validation
  (with fixes), plus two test-authoring mistakes the Playwright suite's first
  run caught in itself.
- [Scenarios](docs/scenarios.md) — greenfield / brownfield (a real bug fix,
  with before/after diff) / ambiguous-requirement worked examples.
- [Engineering summary](docs/engineering-summary.md) — assumptions, risks,
  trade-offs, validation approach, limitations, lessons learned.
- [Test cases](docs/test-cases.md) — manual test cases (ID'd, steps +
  expected results) with a traceability matrix to the automated suites.
