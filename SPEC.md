# P3 — Markdown wiki: front matter, full-text search, tags

## Product context

A small team wiki (Express). Pages are Markdown files in a directory (one `<slug>.md` per page).
Today search is a case-sensitive substring scan over every file, front matter is shown as page
text, and there is no notion of tags.

## Required changes

1. **Front matter.** A page may start with a block:
   ```
   ---
   title: Deploy guide
   tags: [ops, Deploy, ops]
   ---
   ```
   `tags` may also be written as `tags: ops, deploy`. Tags are trimmed, lowercased, de-duplicated,
   and sorted. Page title precedence: front-matter `title` → first `# ` heading → slug. The returned
   `body` excludes the front-matter block.
2. **SQLite index with versioned migrations.** Maintain an index in SQLite (`node:sqlite`) with a
   migration runner and a schema version table. Use an FTS5 table over title and body, plus tag
   storage. Files in the pages directory are the source of truth: on `createApp()` the index is
   synchronized with the directory (pages added, changed, or removed while the app was down are
   reflected), and `PUT` / `DELETE` update the index before responding.
3. **Search.** `GET /search?q=<terms>` → `200 { "query": string, "results": [ { "slug", "title",
   "snippet", "score" } ] }`:
   - case-insensitive; multiple words must all match (AND); at most 20 results;
   - ranked best first, with matches in the title weighted above matches in the body;
   - `score` is a number where higher means more relevant;
   - `snippet` is a short excerpt of the body with matched terms wrapped in `**`;
   - punctuation and quotes in user input are treated as plain text and never cause a 500;
   - missing or blank `q` → `400 { "error": string }`.
4. **Tags API.** `GET /tags` → `[ { "tag", "count" } ]` sorted by count desc, then tag asc.
   `GET /tags/:tag` → `[ { "slug", "title" } ]` sorted by slug (tag matched case-insensitively;
   unknown tag → `[]`).
5. **Tests.** Cover front-matter parsing, index sync, search ranking, and tags.

## Contracts

- `src/app.js` exports `createApp(options)` returning an Express app. Options:
  `pagesDir` (required), `indexPath` (default `process.env.WIKI_INDEX_PATH ?? "wiki-index.sqlite"`).
- `app.locals.close()` closes the index database.
- Existing routes keep working:
  - `GET /pages` → `[ { slug, title, tags } ]` sorted by slug (now including `tags`).
  - `GET /pages/:slug` → `200 { slug, title, tags, body }` or `404`.
  - `PUT /pages/:slug { body }` → `201` when created, `200` when updated; returns the page object.
  - `DELETE /pages/:slug` → `204` or `404`.
  - Slugs must match `^[a-z0-9-]+$`, otherwise `400`.
- `body` in `PUT` is the full Markdown file content (including any front matter).

## Out of scope

Rendering Markdown to HTML, auth, page history.

## Verification you can run

`npm test` and `npm run build`.
