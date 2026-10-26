# Link shortener

A small Express service that turns long URLs into short codes. Links and click
analytics are stored in SQLite (`node:sqlite`) with versioned migrations.

## Quick start

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000
```

## Endpoints

### `POST /links`

Create a short link.

Request body:

```json
{ "url": "https://example.com/docs", "code": "optional" }
```

- `url` (required): absolute `http:` or `https:` URL. Anything else → `400 { "error": string }`.
- `code` (optional): custom short code matching `^[A-Za-z0-9_-]{3,32}$`. Invalid → `400`. Already taken → `409`.

Success → `201`:

```json
{ "code": "abc123", "url": "https://example.com/docs", "shortUrl": "/abc123" }
```

Rate limited per client IP (see Configuration). Over the limit → `429 { "error": string }` with a `Retry-After` header (whole seconds ≥ 1). Rejected requests do not create links.

### `GET /links/:code`

Link metadata → `200 { "code", "url", "createdAt" }` (`createdAt` is an ISO string), or `404`.

### `GET /links/:code/stats`

Click analytics → `200`:

```json
{
  "code": "abc",
  "url": "https://example.com/docs",
  "totalClicks": 3,
  "lastClickedAt": "2026-01-02T03:04:05.000Z",
  "clicksByDay": { "2026-01-02": 3 }
}
```

- `lastClickedAt` is an ISO string, or `null` when there are no clicks.
- `clicksByDay` keys are UTC `YYYY-MM-DD` dates (empty object when no clicks).
- Unknown code → `404`.
- Stats requests are not rate limited and do not count as clicks.

### `GET /:code`

Redirect → `302` with `Location: <url>`, or `404`. Each successful redirect records a click (timestamp + `Referer`, or `null`). Redirects are not rate limited. Clicks persist across restarts.

## Configuration

Environment variables (used by `npm start` / `createApp()` defaults):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `DATABASE_PATH` | `shortener.sqlite` | SQLite database file |
| `RATE_LIMIT_MAX` | `20` | Max `POST /links` requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Fixed window length in milliseconds |

Programmatic options for `createApp(options?)`:

| Option | Default | Purpose |
| --- | --- | --- |
| `databasePath` | `process.env.DATABASE_PATH ?? "shortener.sqlite"` | SQLite path |
| `rateLimitMax` | `Number(process.env.RATE_LIMIT_MAX ?? 20)` | Create limit per IP |
| `rateLimitWindowMs` | `Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000)` | Window size |
| `now` | `() => Date.now()` | Epoch ms clock for click timestamps and rate-limit windows |

Call `app.locals.close()` to close the database when shutting down a programmatically created app.
