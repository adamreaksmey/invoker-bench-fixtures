# Markdown wiki

A small Express wiki. Each page is a Markdown file in `pages/` named `<slug>.md`.

- `GET /pages`, `GET /pages/:slug`, `PUT /pages/:slug { body }`, `DELETE /pages/:slug`
- `GET /search?q=` — full-text search over the SQLite index

## Search

`GET /search?q=<terms>` returns `{ query, results: [ { slug, title, snippet, score } ] }`. Matching is
case-insensitive and every term must be present (AND), so `deploy incident` only returns pages
containing both words. Results are ordered best first, with title matches weighted above body
matches (a term repeated in the body also helps); `score` is a number where higher is more relevant,
and the list is capped at 20 entries. `snippet` is a short body excerpt with each matched term
wrapped in `**`.

Query punctuation and quotes are plain text: input is split into word tokens before it reaches FTS5,
so `"deploy"`, `deploy*`, or `c++` can never be read as query syntax or cause a 500. A query with no
word characters returns an empty result list. A missing or blank `q` is `400 { error }`.

## SQLite index

`createApp({ pagesDir, indexPath })` keeps a SQLite index (`node:sqlite`) beside the Markdown
files. `indexPath` defaults to `WIKI_INDEX_PATH`, then `wiki-index.sqlite`. On startup the index is
synchronized with the pages directory (pages added, changed, or removed while the app was down are
reflected); `PUT` and `DELETE` update it before responding. Files stay the source of truth.

The schema is versioned by `src/sqlite-migrations.js`, which records applied versions in a
`schema_version` table. The page index holds `pages` rows (slug, title, body, content hash), an FTS5
table over title and body, and `page_tags` rows. `app.locals.close()` closes the database.

## Front matter

A page may open with a front-matter block:

```markdown
---
title: Deploy guide
tags: [ops, Deploy, ops]
---
```

`tags` also accepts `tags: ops, deploy`. Tags are trimmed, lowercased, de-duplicated, and sorted.
The page title comes from front-matter `title`, then the first `# ` heading, then the slug. `body`
never includes the front-matter block.

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000, pages from WIKI_PAGES_DIR (default ./pages)
```
