# Markdown wiki

A small Express wiki. Each page is a Markdown file in `pages/` named `<slug>.md`.

- `GET /pages`, `GET /pages/:slug`, `PUT /pages/:slug { body }`, `DELETE /pages/:slug`
- `GET /search?q=` — substring search

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
