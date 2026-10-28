import express from "express";
import { deletePage, readPage, writePage, SLUG_PATTERN } from "./pages.js";
import { openIndex } from "./wikiIndex.js";

function requireValidSlug(req, res, next) {
  if (!SLUG_PATTERN.test(req.params.slug)) {
    return res.status(400).json({ error: "invalid slug" });
  }
  return next();
}

export function createApp(options = {}) {
  const pagesDir = options.pagesDir;
  if (!pagesDir) throw new TypeError("pagesDir is required");
  const indexPath = options.indexPath ?? process.env.WIKI_INDEX_PATH ?? "wiki-index.sqlite";
  const index = openIndex(indexPath, pagesDir);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/pages", (_req, res) => {
    res.json(index.listPages());
  });

  app.get("/pages/:slug", requireValidSlug, (req, res) => {
    const page = readPage(pagesDir, req.params.slug);
    if (!page) return res.status(404).json({ error: "page not found" });
    return res.json(page);
  });

  app.put("/pages/:slug", requireValidSlug, (req, res) => {
    const body = req.body?.body;
    if (typeof body !== "string") {
      return res.status(400).json({ error: "body must be a string" });
    }
    const existed = writePage(pagesDir, req.params.slug, body);
    const page = readPage(pagesDir, req.params.slug);
    index.indexPage(page);
    return res.status(existed ? 200 : 201).json(page);
  });

  app.delete("/pages/:slug", requireValidSlug, (req, res) => {
    if (!deletePage(pagesDir, req.params.slug)) {
      return res.status(404).json({ error: "page not found" });
    }
    index.removePage(req.params.slug);
    return res.status(204).end();
  });

  app.get("/search", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (!query.trim()) {
      return res.status(400).json({ error: "query is required" });
    }
    return res.json({ query, results: index.search(query) });
  });

  app.get("/tags", (_req, res) => {
    res.json(index.listTags());
  });

  app.get("/tags/:tag", (req, res) => {
    res.json(index.findPagesByTag(req.params.tag));
  });

  app.locals.close = () => index.close();
  return app;
}
