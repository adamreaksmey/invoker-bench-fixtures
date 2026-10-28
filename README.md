# Markdown wiki

A small Express wiki. Each page is a Markdown file in `pages/` named `<slug>.md`.

- `GET /pages` — `[ { slug, title, tags } ]` sorted by slug
- `GET /pages/:slug` — `200 { slug, title, tags, body }` or `404`
- `PUT /pages/:slug { body }` — `201` created, `200` updated; `body` is the full Markdown file
  content, front matter included
- `DELETE /pages/:slug` — `204` or `404`
- `GET /search?q=` — full-text search over the SQLite index
- `GET /tags` — every tag with its page count
- `GET /tags/:tag` — pages carrying a tag

Slugs must match `^[a-z0-9-]+$`; anything else is `400 { error }`.

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

Search matches the page title (front-matter `title`, heading, or slug) and the body. Other
front-matter keys and values are never indexed or searched.

## Tags

`GET /tags` returns `[ { tag, count } ]` ordered by `count` desc, then `tag` asc, so the most used
tags come first. Tags come from the page index, so they agree with `GET /pages` and `GET /search`.

`GET /tags/:tag` returns `[ { slug, title } ]` ordered by slug. The requested tag is trimmed and
lowercased before lookup, so `/tags/OPS` and `/tags/ops` are the same request. An unknown or blank
tag returns `[]`, not an error.

## SQLite index

`createApp({ pagesDir, indexPath })` keeps a SQLite index (`node:sqlite`) beside the Markdown
files. Both options are documented under [Configuration](#configuration). On startup the index is
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

The block is only recognized at the very start of the file; an unclosed block is left in the body as
ordinary text.

## Configuration

`createApp(options)` accepts:

| Option | Default | Purpose |
| --- | --- | --- |
| `pagesDir` | required | Directory holding `<slug>.md` page files |
| `indexPath` | `process.env.WIKI_INDEX_PATH`, then `wiki-index.sqlite` | SQLite index file |

`npm start` reads the environment instead:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WIKI_PAGES_DIR` | `pages` | Directory holding `<slug>.md` page files |
| `WIKI_INDEX_PATH` | `wiki-index.sqlite` | SQLite index file |
| `PORT` | `3000` | Port bound on `127.0.0.1` |

`*.sqlite` files are gitignored, so the index can always be rebuilt from the Markdown sources.

```bash
npm ci
npm test
npm run build
npm start   # http://127.0.0.1:3000, pages from WIKI_PAGES_DIR (default ./pages)
```
