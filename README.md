# Markdown wiki

A small Express wiki backed by Markdown files and a synchronized SQLite search index.
Each page is a Markdown file in `pages/` named `<slug>.md`.

## API

- `GET /pages` — list pages as `{ slug, title, tags }`, sorted by slug.
- `GET /pages/:slug` — read `{ slug, title, tags, body }`.
- `PUT /pages/:slug` with `{ "body": "..." }` — create or replace the full Markdown file, including front matter.
- `DELETE /pages/:slug` — remove a page.
- `GET /search?q=<terms>` — case-insensitive AND search, returning up to 20 ranked results with snippets.
- `GET /tags` — list tags with page counts.
- `GET /tags/:tag` — list pages for a tag; tag matching is case-insensitive.

Pages may begin with YAML-style front matter. `title` takes precedence over the first `# ` heading,
then the slug is used. `tags` accepts either `[ops, deploy]` or `ops, deploy`; tags are normalized
to lowercase, trimmed, de-duplicated, and sorted. The front matter is omitted from the returned body.

The SQLite index is synchronized from the pages directory when the app starts and updated by page writes
and deletes. Slugs must match `^[a-z0-9-]+$`.

## Configuration

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000
```

Set `WIKI_PAGES_DIR` to change the pages directory (default `./pages`) and `WIKI_INDEX_PATH` to
change the SQLite index path (default `wiki-index.sqlite`). `createApp({ pagesDir, indexPath })`
accepts the same settings programmatically; `pagesDir` is required. Call `app.locals.close()` when
disposing an app.
