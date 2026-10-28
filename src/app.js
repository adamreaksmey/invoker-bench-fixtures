import express from "express";
import { DEFAULT_INDEX_PATH, createPageIndex } from "./page-index.js";
import { SLUG_PATTERN, deletePage, listSlugs, readPage, writePage } from "./pages.js";
import { isBlankQuery } from "./search.js";

function requireValidSlug(req, res, next) {
  if (!SLUG_PATTERN.test(req.params.slug)) return res.status(400).json({ error: "invalid slug" });
  return next();
}

function resolveIndexPath(options) {
  return options.indexPath ?? process.env.WIKI_INDEX_PATH ?? DEFAULT_INDEX_PATH;
}

export function createApp(options = {}) {
  const pagesDir = options.pagesDir;
  if (!pagesDir) throw new TypeError("pagesDir is required");
  const index = createPageIndex({ pagesDir, indexPath: resolveIndexPath(options) });
  index.syncWithDirectory();
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
    const slug = req.params.slug;
    const body = req.body?.body;
    if (typeof body !== "string") return res.status(400).json({ error: "body must be a string" });
    const existed = writePage(pagesDir, slug, body);
    index.replacePage(slug, body);
    return res.status(existed ? 200 : 201).json(readPage(pagesDir, slug));
  });

  app.delete("/pages/:slug", requireValidSlug, (req, res) => {
    const slug = req.params.slug;
    if (!deletePage(pagesDir, slug)) return res.status(404).json({ error: "page not found" });
    index.removePage(slug);
    return res.status(204).end();
  });

  app.get("/search", (req, res) => {
    const query = req.query.q;
    if (isBlankQuery(query)) return res.status(400).json({ error: "q is required" });
    return res.json({ query, results: index.search(query) });
  });

  app.locals.close = () => index.close();
  return app;
}
