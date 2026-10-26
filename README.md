# Markdown wiki

A small Express wiki. Each page is a Markdown file in a pages directory named `<slug>.md`.
Optional YAML-like front matter at the top of a file supplies `title` and `tags`; the SQLite
search index is kept in sync with that directory.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/pages` | List pages as `[{ slug, title, tags }]`, sorted by slug |
| `GET` | `/pages/:slug` | Page `{ slug, title, tags, body }`, or `404`. Invalid slug → `400` |
| `PUT` | `/pages/:slug` | Create (`201`) or update (`200`) from `{ body }` (full Markdown, including front matter) |
| `DELETE` | `/pages/:slug` | Delete page (`204`) or `404` |
| `GET` | `/search?q=` | Full-text search (see below) |
| `GET` | `/tags` | `[{ tag, count }]` sorted by count desc, then tag asc |
| `GET` | `/tags/:tag` | `[{ slug, title }]` for that tag (case-insensitive); unknown tag → `[]` |

Slugs must match `^[a-z0-9-]+$`.

### Front matter

A page may start with:

```markdown
---
title: Deploy guide
tags: [ops, Deploy, ops]
---
```

`tags` may also be written as `tags: ops, deploy`. Tags are trimmed, lowercased, de-duplicated,
and sorted. Title precedence: front-matter `title` → first `# ` heading → slug. The `body`
returned by the API excludes the front-matter block.

### Search

`GET /search?q=<terms>` → `200 { "query", "results": [{ "slug", "title", "snippet", "score" }] }`:

- Case-insensitive; multiple words must all match (AND); at most 20 results
- Ranked best first; title matches weigh more than body matches (`score` higher = more relevant)
- `snippet` is a short body excerpt with matched terms wrapped in `**`
- Punctuation and quotes in `q` are treated as plain text (never cause a `500`)
- Missing or blank `q` → `400 { "error": string }`

### Index

On `createApp()`, a SQLite index (`node:sqlite`, FTS5 + tags, versioned migrations) is opened and
synchronized with the pages directory (adds, changes, and removals while the app was down are
picked up). `PUT` / `DELETE` update the index before responding. Call `app.locals.close()` to
close the database.

## Configuration

`createApp({ pagesDir, indexPath })`:

| Option | Required | Default |
| --- | --- | --- |
| `pagesDir` | yes | — |
| `indexPath` | no | `process.env.WIKI_INDEX_PATH ?? "wiki-index.sqlite"` |

When starting via `npm start` (`src/server.js`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `WIKI_PAGES_DIR` | `pages` | Markdown pages directory |
| `WIKI_INDEX_PATH` | `wiki-index.sqlite` | SQLite index file path |
| `PORT` | `3000` | HTTP listen port (`127.0.0.1`) |

## Commands

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000
```
