# Link shortener

A small Express service that turns long URLs into short codes.

- `POST /links { url, code? }` → `201 { code, url, shortUrl }`
- `GET /links/:code` → link metadata
- `GET /links/:code/stats` → click totals, last click time, and daily UTC counts
- `GET /:code` → `302` redirect

Creation accepts only absolute `http:` and `https:` URLs. An optional custom code must contain 3–32
letters, numbers, underscores, or hyphens. Invalid input returns `400`, and an existing custom
code returns `409`. Unknown link and stats codes return `404`. Each redirect records a click and
its optional `Referer` header. Stats requests do not add clicks.

Links and clicks are stored in SQLite in the database selected by `DATABASE_PATH` (default:
`shortener.sqlite`). The app applies versioned schema migrations when it opens the database.
Link creation is limited per client IP with a fixed window; rejected requests return `429` with a
`Retry-After` header. The defaults are 20 creations per 60 seconds.

Configuration can be provided through environment variables or `createApp(options)`:

| Setting | Environment variable | `createApp` option | Default |
| --- | --- | --- | --- |
| SQLite file | `DATABASE_PATH` | `databasePath` | `shortener.sqlite` |
| Maximum creations per IP per window | `RATE_LIMIT_MAX` | `rateLimitMax` | `20` |
| Rate limit window in milliseconds | `RATE_LIMIT_WINDOW_MS` | `rateLimitWindowMs` | `60000` |
| Clock for timestamps and rate limits | — | `now` | `() => Date.now()` |

`createApp` returns an Express app. Call `app.locals.close()` when shutting it down to close the
database connection. `now` is a function returning epoch milliseconds and is useful for controlled
time in tests.

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000
```
