# Link shortener

A small Express service that turns long URLs into short codes, persists them in SQLite, and
records click analytics.

## Endpoints

| Method | Path                 | Success                         | Errors                                  |
| ------ | -------------------- | ------------------------------- | --------------------------------------- |
| `POST` | `/links`             | `201 { code, url, shortUrl }`   | `400`, `409`, `429`                     |
| `GET`  | `/links/:code`       | `200 { code, url, createdAt }`  | `404`                                   |
| `GET`  | `/links/:code/stats` | `200` (see below)               | `404`                                   |
| `GET`  | `/:code`             | `302` with `Location: <url>`    | `404`                                   |

### `POST /links`

Request body: `{ "url": "https://example.com/very/long/path", "code": "custom" }`.

- `url` must be an absolute `http:` or `https:` URL, otherwise `400 { "error": string }`.
- `code` is optional. When present it must match `^[A-Za-z0-9_-]{3,32}$`, otherwise `400`.
  Omit it (or send `null`) to have a six-character code generated.
- A `code` that already exists returns `409 { "error": string }` and leaves the original link
  untouched.
- Only this route is rate limited (see [Configuration](#configuration)). A rejected request
  returns `429 { "error": string }` with a `Retry-After` header holding a whole number of
  seconds (`>= 1`) and never creates a link.

### `GET /links/:code/stats`

```json
{
  "code": "abc",
  "url": "https://example.com/very/long/path",
  "totalClicks": 3,
  "lastClickedAt": "2026-01-02T03:04:05.000Z",
  "clicksByDay": { "2026-01-02": 3 }
}
```

Every successful redirect (`302`) records a click with its timestamp and the `Referer` header
(or `null` when absent). `lastClickedAt` is an ISO string, or `null` when the link has no
clicks. `clicksByDay` keys are UTC `YYYY-MM-DD` dates and the object is empty when there are no
clicks. Requesting stats is not itself a click. Unknown codes return `404`. Clicks persist
across restarts.

## Configuration

`createApp(options?)` in `src/app.js` accepts:

| Option              | Default                                        | Purpose                                       |
| ------------------- | ---------------------------------------------- | --------------------------------------------- |
| `databasePath`      | `process.env.DATABASE_PATH ?? "shortener.sqlite"` | SQLite file holding links and clicks.       |
| `rateLimitMax`      | `Number(process.env.RATE_LIMIT_MAX ?? 20)`     | Allowed `POST /links` requests per window.    |
| `rateLimitWindowMs` | `Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000)` | Fixed rate-limit window length, in ms.  |
| `now`               | `() => Date.now()`                             | Epoch-ms clock for click times and windows.   |

Rate limiting is a fixed window per client IP (`req.ip`). Behind a proxy, enable Express'
`trust proxy` setting on the returned app so `req.ip` reflects the real client.

The exported app exposes `app.locals.close()` to close the database. It is safe to call more
than once.

### Environment variables

| Variable               | Default             | Purpose                                    |
| ---------------------- | ------------------- | ------------------------------------------ |
| `DATABASE_PATH`        | `shortener.sqlite`  | SQLite database file path.                 |
| `RATE_LIMIT_MAX`       | `20`                | `POST /links` allowance per window.        |
| `RATE_LIMIT_WINDOW_MS` | `60000`             | Rate-limit window length in milliseconds.  |
| `PORT`                 | `3000`              | Listening port for `npm start`.            |

Non-numeric `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` values fall back to the defaults above;
explicit `createApp` options always win over the environment.

## Persistence and migrations

Links and clicks live in SQLite via `node:sqlite`. On every start `src/database.js` applies
pending migrations from `src/migrations.js` and records each applied version in
`schema_migrations` (one row per version, applied inside a transaction). A process opening an
existing database reads links and clicks written by any other process, and never re-applies an
already-recorded version.

## Development

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000
```

`npm test` runs the `node:test` suites in `test/` covering persistence and migrations,
validation, click analytics, and rate limiting. `npm run build` syntax-checks every source and
test file.

## Out of scope

Authentication, link expiry, and custom domains.

## Error responses

All error responses are JSON of the shape `{ "error": string }`, including `400` responses for
malformed or oversized JSON request bodies.
