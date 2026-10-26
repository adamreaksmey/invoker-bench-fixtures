# Markdown wiki

A small Express wiki. Each page is a Markdown file in `pages/` named `<slug>.md`.

- `GET /pages`, `GET /pages/:slug`, `PUT /pages/:slug { body }`, `DELETE /pages/:slug`
- `GET /search?q=` — substring search

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000, pages from WIKI_PAGES_DIR (default ./pages)
```
