# P2 — Link shortener: persistence, click analytics, rate limiting

## Product context

A small URL-shortening service (Express). Users create short codes for long URLs and visitors are
redirected. Today links live in an in-memory `Map`, any string is accepted as a URL, there is no
analytics, and link creation can be spammed.

## Required changes

1. **Persistence with versioned migrations.** Store links in SQLite using `node:sqlite`, with a
   migration runner and a `schema_migrations` table (one row per applied version). Links created by
   one app instance must be readable by a new instance opened on the same database file.
2. **URL and code validation.**
   - `POST /links` with a `url` that is not an absolute `http:` or `https:` URL → `400 { "error": string }`.
   - Optional custom `code` must match `^[A-Za-z0-9_-]{3,32}$`, otherwise `400`.
   - A custom `code` that already exists → `409 { "error": string }`.
3. **Click analytics.** Every redirect (`GET /:code` returning 302) records a click with its
   timestamp and the `Referer` header (or null). Add
   `GET /links/:code/stats` → `200`:
   ```json
   { "code": "abc", "url": "https://…", "totalClicks": 3,
     "lastClickedAt": "2026-01-02T03:04:05.000Z", "clicksByDay": { "2026-01-02": 3 } }
   ```
   `lastClickedAt` is an ISO string or `null` when there are no clicks; `clicksByDay` keys are UTC
   `YYYY-MM-DD` dates (empty object when no clicks). Unknown code → `404`. Stats requests do not
   count as clicks. Clicks persist across restarts.
4. **Rate limiting on link creation.** Fixed-window limit per client IP (`req.ip`) applied only to
   `POST /links`. When a client exceeds the limit in the current window, respond
   `429 { "error": string }` with a `Retry-After` header holding a whole number of seconds ≥ 1.
   Redirects and stats are never rate limited. Rejected requests do not create links.
5. **Tests.** Unit/integration tests for persistence, validation, analytics, and rate limiting.

## Contracts

- `src/app.js` exports `createApp(options?)` returning an Express app. Options:
  - `databasePath` (default `process.env.DATABASE_PATH ?? "shortener.sqlite"`),
  - `rateLimitMax` (default `Number(process.env.RATE_LIMIT_MAX ?? 20)`),
  - `rateLimitWindowMs` (default `Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000)`),
  - `now` (default `() => Date.now()`; returns epoch milliseconds and must be used for click
    timestamps and rate-limit windows).
- `app.locals.close()` closes the database.
- Existing routes keep their shapes:
  - `POST /links { url, code? }` → `201 { code, url, shortUrl }` where `shortUrl` is `/<code>`.
  - `GET /links/:code` → `200 { code, url, createdAt }` (ISO string) or `404`.
  - `GET /:code` → `302` with `Location: <url>` or `404`.

## Out of scope

Authentication, link expiry, custom domains.

## Verification you can run

`npm test` and `npm run build`.
