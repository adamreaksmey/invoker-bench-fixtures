import express from "express";
import { SLUG_PATTERN, deletePage, listSlugs, readPage, writePage } from "./pages.js";
import { PageIndex } from "./index.js";

function requireValidSlug(req, res, next) {
  if (!SLUG_PATTERN.test(req.params.slug)) return res.status(400).json({ error: "invalid slug" });
  return next();
}

export function createApp(options = {}) {
  const pagesDir = options.pagesDir;
  if (!pagesDir) throw new TypeError("pagesDir is required");
  const indexPath = options.indexPath ?? process.env.WIKI_INDEX_PATH ?? "wiki-index.sqlite";
  const index = new PageIndex(indexPath);
  index.replaceAll(listSlugs(pagesDir).map((slug) => readPage(pagesDir, slug)));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/pages", (_req, res) => {
    res.json(listSlugs(pagesDir).map((slug) => {
      const { title, tags } = readPage(pagesDir, slug);
      return { slug, title, tags };
    }));
  });

  app.get("/pages/:slug", requireValidSlug, (req, res) => {
    const page = readPage(pagesDir, req.params.slug);
    if (!page) return res.status(404).json({ error: "page not found" });
    return res.json(page);
  });

  app.put("/pages/:slug", requireValidSlug, (req, res) => {
    const body = req.body?.body;
    if (typeof body !== "string") return res.status(400).json({ error: "body must be a string" });
    const existed = writePage(pagesDir, req.params.slug, body);
    index.upsert(readPage(pagesDir, req.params.slug));
    return res.status(existed ? 200 : 201).json(readPage(pagesDir, req.params.slug));
  });

  app.delete("/pages/:slug", requireValidSlug, (req, res) => {
    if (!deletePage(pagesDir, req.params.slug)) return res.status(404).json({ error: "page not found" });
    index.remove(req.params.slug);
    return res.status(204).end();
  });

  app.get("/search", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (!query.trim()) return res.status(400).json({ error: "q is required" });
    return res.json({ query, results: index.search(query) });
  });

  app.get("/tags", (_req, res) => res.json(index.tags()));
  app.get("/tags/:tag", (req, res) => res.json(index.pagesForTag(req.params.tag)));

  app.locals.close = () => index.close();
  return app;
}
