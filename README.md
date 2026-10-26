# Link shortener

A small Express service that turns absolute HTTP(S) URLs into short codes. Links and click
analytics are stored in SQLite, so they survive application restarts.

## API

- `POST /links` with `{ "url": "https://example.com", "code": "optional-custom-code" }` →
  `201 { code, url, shortUrl }`. URLs must use `http:` or `https:`. Custom codes must match
  `^[A-Za-z0-9_-]{3,32}$`; an existing custom code returns `409`.
- `GET /links/:code` → `200 { code, url, createdAt }`, or `404` for an unknown code.
- `GET /links/:code/stats` → `200 { code, url, totalClicks, lastClickedAt, clicksByDay }`.
  Redirect clicks are grouped by UTC date; an unknown code returns `404`.
- `GET /:code` → `302` redirect and records the click timestamp and optional `Referer` header.

Link creation is limited per client IP with a fixed window. Exceeded limits return `429` and a
whole-second `Retry-After` header. Redirects and stats are not rate limited.

## Configuration

Configuration is read from environment variables, with these defaults:

- `DATABASE_PATH=shortener.sqlite` — SQLite database file.
- `RATE_LIMIT_MAX=20` — link creations allowed per client IP per window.
- `RATE_LIMIT_WINDOW_MS=60000` — rate-limit window length in milliseconds.

For tests or embedding, `createApp(options)` accepts `databasePath`, `rateLimitMax`,
`rateLimitWindowMs`, and `now` (a function returning epoch milliseconds). Call `app.locals.close()`
when the app is no longer needed.

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000
```
