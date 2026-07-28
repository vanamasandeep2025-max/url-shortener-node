# Test Cases

Manual test cases for exploratory/QA sign-off, plus a traceability matrix
showing which of them are covered by automation (Jest unit, Jest integration,
Playwright e2e) and which are manual-only. IDs are stable references used in
both sections and in [ai-usage-log.md](ai-usage-log.md)/[scenarios.md](scenarios.md).

## ID scheme

`TC-<AREA>-<NNN>` — areas: `CRT` create, `RDR` redirect, `STA` stats, `LST`
list, `DEL` delete, `HLT` health, `UI` dashboard, `SEC` security, `REL`
reliability.

## How to execute

- **Manual**: run the server (`npm start` or `npm run dev`), then use
  `curl`/Postman for API-level cases and `http://localhost:3000/ui` for
  dashboard cases. Exact commands are in
  [api-documentation.md](api-documentation.md).
- **Automated**: `npm test` (unit + integration), `npm run test:e2e`
  (Playwright, builds first). See [README.md](../README.md#running-tests).

---

## Manual test cases

### Create (`POST /api/urls`)

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-CRT-001 | Create with a valid URL, no options | POST `{"url":"https://example.com"}` | `201`; response has a 7-char Base62 `code`, matching `shortUrl`, `isActive:true` |
| TC-CRT-002 | Create with a custom alias | POST with `customAlias` (3-32 chars, `[A-Za-z0-9_-]`) | `201`; `code` equals the alias |
| TC-CRT-003 | Create with a future expiry | POST with `expiresAt` set to a future ISO timestamp | `201`; `expiresAt` echoed back |
| TC-CRT-004 | Reject disallowed scheme | POST `{"url":"javascript:alert(1)"}` | `400 BAD_REQUEST`, mentions `http(s)` |
| TC-CRT-005 | Reject missing `url` | POST `{}` | `400 BAD_REQUEST` |
| TC-CRT-006 | Reject oversized URL | POST a URL longer than 2048 chars | `400 BAD_REQUEST` |
| TC-CRT-007 | Reject malformed custom alias | POST with `customAlias:"ab"` (too short) | `400 BAD_REQUEST` |
| TC-CRT-008 | Reject a past `expiresAt` | POST with `expiresAt` in the past | `400 BAD_REQUEST` |
| TC-CRT-009 | Reject a duplicate custom alias | POST twice with the same `customAlias` | Second request: `409 CONFLICT` |
| TC-CRT-010 | Reject malformed JSON body | POST a syntactically invalid JSON body | `400 BAD_REQUEST` (not `500`) |
| TC-CRT-011 | Rate limit rapid creation | POST repeatedly beyond `RATE_LIMIT_POINTS` within the window | Eventually `429 TOO_MANY_REQUESTS` with a `Retry-After` header |

### Redirect (`GET /:code`)

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-RDR-001 | Redirect an active link | GET `/:code` for a link created via TC-CRT-001 | `302`, `Location` header = the long URL |
| TC-RDR-002 | Unknown code | GET `/doesnotexist` | `404 NOT_FOUND` |
| TC-RDR-003 | Soft-deleted code | Delete a link (TC-DEL-001), then GET it | `410 GONE` |
| TC-RDR-004 | Expired code | GET a link whose `expiresAt` has passed | `410 GONE` |
| TC-RDR-005 | Click is recorded | GET `/:code` with a `Referer`/`User-Agent` header, then check TC-STA-001 | `totalClicks` increments; `recentEvents` shows the referrer/user-agent |
| TC-RDR-006 | Fail-open under a Redis outage | Stop/disconnect Redis, then GET `/:code` | Still `302`, resolves in well under a second (not the ~20s it took before the fix — see [scenarios.md](scenarios.md)) |

### Stats (`GET /api/urls/:code/stats`)

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-STA-001 | Stats for an existing link | GET `/api/urls/:code/stats` | `200`; `totalClicks` + `recentEvents` (paginated) |
| TC-STA-002 | Stats for an unknown code | GET `/api/urls/doesnotexist/stats` | `404 NOT_FOUND` |
| TC-STA-003 | Stats remain viewable after expiry/deletion | Delete or let a link expire, then GET its stats | `200`, still returns historical data |

### List (`GET /api/urls`)

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-LST-001 | List with pagination | Create 2+ links, GET `/api/urls?limit=1` | `200`; `items.length === 1`, `total` reflects the full count |
| TC-LST-002 | Excludes inactive by default | Delete a link, GET `/api/urls?includeInactive=false` | Deleted link absent from `items` |
| TC-LST-003 | Includes inactive on request | GET `/api/urls?includeInactive=true` | Deleted link present, `isActive:false` |

### Delete (`DELETE /api/urls/:code`)

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-DEL-001 | Delete an existing link | DELETE `/api/urls/:code` | `204`; subsequent redirect returns `410` (TC-RDR-003) |
| TC-DEL-002 | Delete an unknown code | DELETE `/api/urls/doesnotexist` | `404 NOT_FOUND` |

### Health (`GET /health`)

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-HLT-001 | Healthy state | GET `/health` with Postgres reachable | `200`, `status:"ok"`, `checks.database:"ok"` |
| TC-HLT-002 | Degraded cache, still healthy | GET `/health` with Redis unreachable | `200`, `status:"ok"`, `checks.cache:"down"` (Redis is optional infra) |
| TC-HLT-003 | Unhealthy database | GET `/health` with Postgres unreachable | `503`, `status:"degraded"` |

### Dashboard (`/ui`)

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-UI-001 | Empty state | Open `/ui` with no active links | "No links yet…" empty state shown |
| TC-UI-002 | Create via form | Fill Destination URL, click Shorten | Success banner; new row appears with an Active badge |
| TC-UI-003 | Validation error via form | Submit an invalid URL/alias | Error banner (red), no row added |
| TC-UI-004 | Toggle "Show deleted" | Delete a link, then check/uncheck the toggle | Row disappears by default, reappears (Deleted badge, Delete button disabled) when checked |
| TC-UI-005 | Copy short link | Click the 📋 button on a row | Clipboard contains the short URL; button briefly shows "Copied!" |
| TC-UI-006 | View click details | Visit a short link once, click 📊 on its row | Details panel shows the click's timestamp/referrer/user-agent; Clicks column shows `1` |
| TC-UI-007 | KPI tiles | Open `/ui` with several links | Total/Active/Total Clicks tiles render numeric values (not `—`) |

### Security

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-SEC-001 | Stored-XSS via `longUrl` | Create a link with `url` containing `"><img src=x onerror=alert(1)>` | No JS executes; dashboard renders the payload as literal escaped text, no `<img>` element in the DOM |
| TC-SEC-002 | Stored-XSS via click headers | Hit a redirect with a malicious `Referer`/`User-Agent`, then open its Details panel | No JS executes; values rendered as literal escaped text |
| TC-SEC-003 | Security headers present | Inspect any response's headers | `Content-Security-Policy`, `X-Content-Type-Options`, etc. (Helmet defaults) present |
| TC-SEC-004 | CORS scoped | `fetch` the API from an origin not in `CORS_ALLOWED_ORIGINS` | Request blocked by the browser (no `Access-Control-Allow-Origin` for that origin) |

### Reliability

| ID | Title | Steps | Expected Result |
|---|---|---|---|
| TC-REL-001 | Redis outage doesn't block create | Stop Redis, POST `/api/urls` | Still `201`, link created normally |
| TC-REL-002 | Rate limiter falls back without Redis | Stop Redis, exceed the creation rate limit | Still enforced via the in-memory fallback limiter — `429` |
| TC-REL-003 | Code collision retry | (Unit-level) force two consecutive generated codes to collide | Second attempt succeeds transparently, no error surfaced to the caller |
| TC-REL-004 | Graceful shutdown | Send `SIGTERM`/`SIGINT` to the running process | Stops accepting new connections, drains in-flight requests, exits cleanly within 10s |

---

## Automated test coverage (traceability matrix)

`✅ automated` / `🖐 manual-only` (verified by hand during this project, not scripted).

| Manual TC | Automated as | Type | File |
|---|---|---|---|
| TC-CRT-001 | "creates a short URL with a generated code" / "creates a short link with a randomly generated code" | Integration + E2E | `tests/integration/api.test.ts`, `tests/e2e/create-link.spec.ts` |
| TC-CRT-002 | "supports a custom alias…" / "creates a short link with a custom alias" | Integration + E2E | same files |
| TC-CRT-003 | "creates a short link with a future expiry date" | E2E | `tests/e2e/create-link.spec.ts` |
| TC-CRT-004 | "rejects an invalid long URL…" / "rejects a non-http(s) URL…" / "rejects a disallowed URL scheme…" | Unit + Integration + E2E | `urlService.test.ts`, `api.test.ts`, `create-link.spec.ts` |
| TC-CRT-005 | "rejects a missing url field with 400" | Integration | `api.test.ts` |
| TC-CRT-006 | 🖐 manual-only | — | — |
| TC-CRT-007 | "rejects a malformed custom alias" / "…with a server-side validation error" + "the browser itself blocks…" | Unit + E2E | `urlService.test.ts`, `create-link.spec.ts` |
| TC-CRT-008 | "rejects an expiresAt that isn't in the future" | Unit + Integration | `urlService.test.ts`, `api.test.ts` |
| TC-CRT-009 | "returns 409…" / "shows a conflict error when a custom alias is already taken" | Unit + Integration + E2E | all three suites |
| TC-CRT-010 | "rejects malformed JSON with 400, not 500" | Integration | `api.test.ts` (regression test for bug #3, see [ai-usage-log.md](ai-usage-log.md)) |
| TC-CRT-011 | "rate limits rapid link creation…" | E2E | `tests/e2e/rate-limit.spec.ts` (isolated server, `RATE_LIMIT_POINTS=3`) |
| TC-RDR-001 | "redirects to the long URL…" | Integration + E2E | `api.test.ts`, `list-and-manage.spec.ts` |
| TC-RDR-002 | "returns 404 for an unknown code" | Unit + Integration | `urlService.test.ts`, `api.test.ts` |
| TC-RDR-003 | "returns 410 for a soft-deleted code" | Unit + Integration + E2E | all three |
| TC-RDR-004 | "returns 410 for an expired code" | Unit + Integration | `urlService.test.ts`, `api.test.ts` |
| TC-RDR-005 | "records a click via the redirect and shows it in Clicks + Details" | Integration + E2E | `api.test.ts`, `list-and-manage.spec.ts` |
| TC-RDR-006 | 🖐 manual-only (timed by hand, see [scenarios.md](scenarios.md)); unit test covers the fail-open *logic*, not wall-clock latency | Unit (logic only) | `urlService.test.ts` ("still resolves the redirect when Redis is unavailable") |
| TC-STA-001 | "returns total clicks and recent events" | Unit + E2E | `urlService.test.ts`, `list-and-manage.spec.ts` |
| TC-STA-002 | "throws NotFound…" / "returns 404 for an unknown code" | Unit + Integration | `urlService.test.ts`, `api.test.ts` |
| TC-STA-003 | 🖐 manual-only | — | — |
| TC-LST-001 | "lists created URLs with pagination" | Integration + E2E | `api.test.ts`, `list-and-manage.spec.ts` |
| TC-LST-002 / 003 | "excludes soft-deleted links when includeInactive=false" / "…reveals it via 'Show deleted'" | Integration + E2E | `api.test.ts` (regression test for bug #4), `list-and-manage.spec.ts` |
| TC-DEL-001 | "marks the record inactive…" / "deleting a link hides it by default…" | Unit + Integration + E2E | all three |
| TC-DEL-002 | "returns 404 for an unknown code" | Unit + Integration | `urlService.test.ts`, `api.test.ts` |
| TC-HLT-001 | "reports the database as ok" | Integration | `api.test.ts` |
| TC-HLT-002 | 🖐 manual-only (verified live, see [ai-usage-log.md](ai-usage-log.md)) | — | — |
| TC-HLT-003 | 🖐 manual-only | — | — |
| TC-UI-001 | "shows an empty state when there are no active links" | E2E | `list-and-manage.spec.ts` |
| TC-UI-002 | "creating a link clears the empty state and lists it" | E2E | `list-and-manage.spec.ts` |
| TC-UI-003 | multiple `create-link.spec.ts` cases | E2E | `create-link.spec.ts` |
| TC-UI-004 | "deleting a link hides it by default and reveals it via 'Show deleted'" | E2E | `list-and-manage.spec.ts` |
| TC-UI-005 | "copies the short link to the clipboard" | E2E | `list-and-manage.spec.ts` |
| TC-UI-006 | "records a click via the redirect and shows it in Clicks + Details" | E2E | `list-and-manage.spec.ts` |
| TC-UI-007 | 🖐 manual-only (visually confirmed; not asserted numerically since totals accumulate across runs — see [ai-usage-log.md](ai-usage-log.md)) | — | — |
| TC-SEC-001 | "escapes a malicious long URL instead of executing it" | E2E | `tests/e2e/security.spec.ts` |
| TC-SEC-002 | "escapes a malicious referrer/user-agent in the click details view" | E2E | `tests/e2e/security.spec.ts` |
| TC-SEC-003 / 004 | 🖐 manual-only (inspected via `curl -i`, see engineering-summary.md) | — | — |
| TC-REL-001 | "still resolves the redirect when Redis is unavailable" / live curl walkthrough | Unit + manual | `urlService.test.ts` |
| TC-REL-002 | "rate limits rapid link creation…" | E2E | `tests/e2e/rate-limit.spec.ts` |
| TC-REL-003 | "retries on a code collision and succeeds…" / "gives up after repeated collisions" | Unit | `urlService.test.ts` |
| TC-REL-004 | 🖐 manual-only | — | — |

### Coverage summary

- **65 automated tests** total: 34 Jest unit, 15 Jest integration, 16 Playwright e2e.
- **Manual-only, by design**: cases that need wall-clock timing judgment
  (TC-RDR-006), infrastructure states awkward to script reliably in this
  environment (TC-HLT-002/003 — no easy way to kill Postgres mid-suite
  without affecting other tests), one-off header inspection (TC-SEC-003/004),
  process-signal behavior (TC-REL-004), and a maximum-length input case
  (TC-CRT-006). None of these are complex to automate — they were simply
  judged lower-value to script for a 2-3 day prototype than to verify once by
  hand and document. See [engineering-summary.md](engineering-summary.md) for
  the full validation-approach rationale.
