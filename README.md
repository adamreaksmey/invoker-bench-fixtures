# Markdown wiki

A small Express wiki. Each page is a Markdown file in the pages directory named `<slug>.md`.
The Markdown files are the source of truth; a SQLite index is rebuilt from them whenever the
app starts and kept current by page writes and deletes.

## Run

```bash
npm ci
npm test
npm run build
npm start
```

By default, the server listens on `127.0.0.1:3000` and reads pages from `./pages`. Set
`WIKI_PAGES_DIR` to choose another pages directory and `WIKI_INDEX_PATH` to choose the SQLite
index file (default: `wiki-index.sqlite`).

## HTTP API

- `GET /pages` — list pages sorted by slug as `{ slug, title, tags }` objects.
- `GET /pages/:slug` — return `{ slug, title, tags, body }`, or `404` when missing.
- `PUT /pages/:slug` — create or replace a page with JSON `{ "body": "..." }`. The body is the
  full Markdown file, including optional front matter. Returns the page object with `201` for a
  new page or `200` for an update.
- `DELETE /pages/:slug` — delete a page (`204`), or return `404` when missing.
- `GET /search?q=<terms>` — case-insensitive full-text search. All query words must match;
  results are ranked by relevance and limited to 20. Each result contains `slug`, `title`, a
  body `snippet` with matches highlighted using `**`, and a numeric `score`. Missing or blank
  `q` returns `400`.
- `GET /tags` — list `{ tag, count }` entries, ordered by count descending and tag ascending.
- `GET /tags/:tag` — list `{ slug, title }` pages with that tag, matching case-insensitively and
  ordered by slug.

Slugs must contain only lowercase letters, digits, and hyphens (`^[a-z0-9-]+$`). A page may start
with YAML-style front matter delimited by `---`. Its `title` takes precedence over the first
Markdown `# ` heading, then the slug. Tags can be a bracketed list or comma-separated values;
they are trimmed, lowercased, de-duplicated, and sorted. The returned `body` excludes front matter.

When creating an app programmatically, call `createApp({ pagesDir, indexPath })` from
`src/app.js`. `pagesDir` is required; `indexPath` defaults to `WIKI_INDEX_PATH` or
`wiki-index.sqlite`. Close the SQLite connection with `app.locals.close()` when the app shuts down.
