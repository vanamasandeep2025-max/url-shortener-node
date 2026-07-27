# API Documentation

Base URL: `http://localhost:3000` (or `PUBLIC_BASE_URL`). All bodies are JSON.
Errors always have the shape:

```json
{ "error": { "message": "...", "code": "SOME_CODE", "details": "optional" } }
```

## `POST /api/urls`

Create a short URL.

**Request body**
| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | yes | Must be `http(s)`, ≤2048 chars. |
| `customAlias` | string | no | 3-32 chars, `[A-Za-z0-9_-]`. If omitted, a random 7-char Base62 code is generated. |
| `expiresAt` | string (ISO 8601) | no | Must be in the future. Omit for a link that never expires. |

**Responses**
| Status | Meaning |
|---|---|
| `201` | Created. Body: `{ code, shortUrl, longUrl, createdAt, expiresAt, isActive }` |
| `400` | `url` invalid, `customAlias` malformed, `expiresAt` invalid/in the past, or malformed JSON body. |
| `409` | `customAlias` already in use. |
| `429` | Rate limit exceeded (`RATE_LIMIT_POINTS` per `RATE_LIMIT_WINDOW_SECONDS` per IP). `Retry-After` header included. |
| `503` | Could not find a free random code after 5 attempts (practically never at this code space size). |

```bash
curl -X POST http://localhost:3000/api/urls \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/a/very/long/path", "customAlias": "my-link"}'
```

## `GET /:code`

Redirect to the long URL. Constrained to the same charset as codes/aliases
(`[A-Za-z0-9_-]{3,32}`), so it won't shadow other routes.

| Status | Meaning |
|---|---|
| `302` | Redirects to the long URL. `Location` header set. A click is recorded asynchronously (never blocks or fails this response). |
| `404` | Code doesn't exist. |
| `410` | Code existed but is expired or soft-deleted. |

```bash
curl -i http://localhost:3000/my-link
```

## `GET /api/urls/:code/stats`

**Query params**: `limit` (default 20, max 100), `offset` (default 0).

| Status | Meaning |
|---|---|
| `200` | `{ ...shortUrlFields, totalClicks, recentEvents: [{ occurredAt, referrer, userAgent }], pagination }` |
| `404` | Code doesn't exist. (Works for expired/deleted codes — analytics remain queryable.) |

## `GET /api/urls`

List short URLs.

**Query params**: `limit` (default 20, max 100), `offset` (default 0),
`includeInactive` (default `false` — set `true` to include soft-deleted links).

**Response**: `200` `{ items: [...], total, pagination }`

## `DELETE /api/urls/:code`

Soft-deletes a short URL (sets `isActive = false`, invalidates its cache entry).

| Status | Meaning |
|---|---|
| `204` | Deleted. |
| `404` | Code doesn't exist. |

## `GET /health`

Liveness/readiness check for orchestration.

```json
{ "status": "ok", "checks": { "database": "ok", "cache": "down" } }
```

`status` is `"ok"` (200) whenever the database is reachable — the cache is
optional infrastructure (see [architecture.md](architecture.md)), so a down
Redis alone does not make the service unhealthy. `status` is `"degraded"`
(503) only when the database itself is unreachable.
