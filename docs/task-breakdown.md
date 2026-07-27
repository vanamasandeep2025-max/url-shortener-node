# Task Breakdown

How the assignment's high-level ask ("build a URL shortener with core APIs,
analytics, and reliability features") was decomposed into sequenced,
actionable work. Reflects what actually happened, including two detours that
weren't foreseeable until the environment was inspected.

## 0. Requirement understanding (before any code)

- Read the assignment brief, identified it wants both a working prototype
  *and* artifacts proving a disciplined AI-assisted process.
- Discovered a prior, untested attempt at this same brief already existed on
  this machine (Spring Boot + React) — surfaced this to the engineer instead
  of silently building over or ignoring it (see
  [ai-usage-log.md](ai-usage-log.md)). Engineer chose to start fresh with a
  Node/TS stack rather than continue that codebase.
- Clarified three things that were genuinely open, not just "figure it out
  later": tech stack, feature depth (core-only vs core+analytics+reliability),
  and project location/VCS.

## 1. Environment setup — *blocking, not foreseeable until inspected*

**Dependency**: nothing (must happen before any build/test step).

- Found no git, Java, Maven, Node, npm on this machine; Docker installed but
  its Linux backend couldn't start (no WSL2 distro at all).
- Installed git and Node LTS via `winget`.
- Diagnosed the Docker blocker down to "no WSL2 distro, virtualization not
  currently active, needs admin elevation + reboot to fix" and stopped rather
  than guessing at more system changes — surfaced it and got a decision:
  install PostgreSQL natively for Windows instead of depending on Docker for
  local Postgres/Redis, since Docker wasn't fixable non-interactively.
- Installed PostgreSQL 16 for Windows via `winget`, created the app role and
  a dev + test database.

## 2. Project scaffold

**Dependency**: environment setup (needs Node/npm and a running Postgres to
validate against later).

`package.json`, `tsconfig.json`, `jest.config.js`, Prisma schema + hand-written
initial migration (written by hand rather than via `prisma migrate dev`, so it
doesn't require a live DB connection to generate), `docker-compose.yml`,
`Dockerfile`, `.env.example`.

## 3. Core domain logic

**Dependency**: scaffold.

Short-code generator (random Base62, `crypto.randomInt` for unbiased
randomness), URL validator (scheme/length), each with unit tests written
alongside the code, not after.

## 4. Service layer (`urlService.ts`)

**Dependency**: domain logic + Prisma schema.

Create (with collision retry / custom-alias conflict handling), redirect
lookup (cache-aside with fail-open), click recording (async, best-effort),
stats, list, soft delete — plus unit tests against a mocked Prisma/Redis
client for every branch (happy path, collision, expiry, deletion, cache miss,
Redis failure).

## 5. HTTP layer

**Dependency**: service layer.

Routes, Zod request validation, centralized `AppError` → JSON error mapping,
Redis-backed rate limiting (with an in-memory insurance fallback), `helmet`/
CORS/structured logging, graceful shutdown.

## 6. Testing — real, not just written

**Dependency**: HTTP layer + a running database.

- Unit tests (Jest, fully mocked, no infra): 34 tests.
- Integration tests (Supertest + the real local Postgres, `ioredis-mock` for
  Redis since no Redis was available in this environment): 13 tests,
  exercising every endpoint's success and error paths end-to-end through a
  real database.
- Actually ran `npx tsc --noEmit`, `npx jest`, and `npx eslint` — and fixed
  what they found, rather than assuming green.

## 7. Live end-to-end validation

**Dependency**: a passing test suite.

Built the project (`npm run build`), ran the compiled server for real, and
drove it with `curl`/`Invoke-RestMethod` through every endpoint, including
the rate limiter and the redirect path with Redis genuinely unreachable. This
step is what caught three real defects that the test suite alone had missed
or couldn't have (see [ai-usage-log.md](ai-usage-log.md) and
[scenarios.md](scenarios.md) for the brownfield write-up of the most
significant one). Each fix was followed by re-running the full test suite and
re-doing the live walkthrough, not just re-reading the diff.

## 8. Documentation

**Dependency**: everything above (docs describe what was actually built and
actually found, not a plan).

Architecture, DB schema, API reference, this breakdown, the AI usage log, the
three scenario write-ups, the engineering summary, and the README.

## 9. Version control

**Dependency**: all of the above.

`git init` plus incremental commits (scaffold → domain logic → API →
reliability → tests → bug fixes found during live validation → docs), so the
commit history itself is a traceability artifact.
