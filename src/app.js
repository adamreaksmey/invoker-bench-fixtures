import express from "express";
import { WikiIndex } from "./index.js";
import { SLUG_PATTERN, deletePage, listSlugs, readPage, writePage } from "./pages.js";

function requireValidSlug(req, res, next) {
  if (!SLUG_PATTERN.test(req.params.slug)) return res.status(400).json({ error: "invalid slug" });
  return next();
}

function snippet(body, query) {
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = escaped.length ? new RegExp(`(${escaped.join("|")})`, "giu") : null;
  const first = pattern ? body.search(pattern) : -1;
  const start = Math.max(0, (first < 0 ? 0 : first) - 55);
  let excerpt = body.slice(start, start + 180).trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (start + 180 < body.length) excerpt += "…";
  return pattern ? excerpt.replace(pattern, "**$1**") : excerpt;
}

export function createApp(options = {}) {
  const pagesDir = options.pagesDir;
  if (!pagesDir) throw new TypeError("pagesDir is required");
  const index = new WikiIndex(options.indexPath ?? process.env.WIKI_INDEX_PATH ?? "wiki-index.sqlite");
  index.sync(pagesDir);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/pages", (_req, res) => res.json(listSlugs(pagesDir).map((slug) => {
    const page = readPage(pagesDir, slug);
    return { slug, title: page.title, tags: page.tags };
  })));
  app.get("/pages/:slug", requireValidSlug, (req, res) => {
    const page = readPage(pagesDir, req.params.slug);
    if (!page) return res.status(404).json({ error: "page not found" });
    return res.json(page);
  });
  app.put("/pages/:slug", requireValidSlug, (req, res) => {
    const body = req.body?.body;
    if (typeof body !== "string") return res.status(400).json({ error: "body must be a string" });
    const existed = writePage(pagesDir, req.params.slug, body);
    const page = readPage(pagesDir, req.params.slug);
    index.upsert(page);
    return res.status(existed ? 200 : 201).json(page);
  });
  app.delete("/pages/:slug", requireValidSlug, (req, res) => {
    if (!deletePage(pagesDir, req.params.slug)) return res.status(404).json({ error: "page not found" });
    index.remove(req.params.slug);
    return res.status(204).end();
  });
  app.get("/search", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (!query.trim()) return res.status(400).json({ error: "q is required" });
    const results = index.search(query).map(({ slug, title, body, score }) => ({ slug, title, snippet: snippet(body, query), score: Number(score) }));
    return res.json({ query, results });
  });
  app.get("/tags", (_req, res) => res.json(index.allTags()));
  app.get("/tags/:tag", (req, res) => res.json(index.pagesWithTag(req.params.tag)));
  app.locals.close = () => index.close();
  return app;
}
