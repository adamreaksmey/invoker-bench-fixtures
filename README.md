# Markdown wiki

A small Express wiki. Each page is a Markdown file in `pages/` named `<slug>.md`.

- `GET /pages`, `GET /pages/:slug`, `PUT /pages/:slug { body }`, `DELETE /pages/:slug`
- `GET /search?q=` — substring search

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
