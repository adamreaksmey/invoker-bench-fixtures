# Link shortener

A small Express service that turns long URLs into short codes.

- `POST /links { url, code? }` → `201 { code, url, shortUrl }`
- `GET /links/:code` → link metadata
- `GET /:code` → `302` redirect

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000
```
