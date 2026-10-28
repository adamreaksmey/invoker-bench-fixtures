import express from "express";
import { SLUG_PATTERN, deletePage, listSlugs, pageModifiedAt, readPage, writePage } from "./pages.js";
import { deletePageFromIndex, findPagesByTag, listTags, openIndex, searchPages, syncIndex, upsertPageInIndex } from "./index.js";

const DEFAULT_INDEX_PATH = "wiki-index.sqlite";
const MAX_REQUEST_BODY = "256kb";

function requireValidSlug(req, res, next) {
  if (SLUG_PATTERN.test(req.params.slug)) return next();
  return res.status(400).json({ error: "invalid slug" });
}

function requireStringBody(req, res, next) {
  if (typeof req.body?.body === "string") return next();
  return res.status(400).json({ error: "body must be a string" });
}

function resolveIndexPath(options) {
  return options.indexPath ?? process.env.WIKI_INDEX_PATH ?? DEFAULT_INDEX_PATH;
}

export function createApp(options = {}) {
  const pagesDir = options.pagesDir;
  if (!pagesDir) throw new TypeError("pagesDir is required");
  const indexPath = resolveIndexPath(options);
  const db = openIndex(indexPath);
  syncIndex(db, pagesDir);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: MAX_REQUEST_BODY }));

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

  app.put("/pages/:slug", requireValidSlug, requireStringBody, (req, res) => {
    const slug = req.params.slug;
    const existed = writePage(pagesDir, slug, req.body.body);
    upsertPageInIndex(db, readPage(pagesDir, slug), pageModifiedAt(pagesDir, slug));
    return res.status(existed ? 200 : 201).json(readPage(pagesDir, slug));
  });

  app.delete("/pages/:slug", requireValidSlug, (req, res) => {
    const slug = req.params.slug;
    if (!deletePage(pagesDir, slug)) return res.status(404).json({ error: "page not found" });
    deletePageFromIndex(db, slug);
    return res.status(204).end();
  });

  app.get("/search", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (query.trim().length === 0) return res.status(400).json({ error: "query is required" });
    return res.json(searchPages(db, query));
  });

  app.get("/tags", (_req, res) => {
    res.json(listTags(db));
  });

  app.get("/tags/:tag", (req, res) => {
    res.json(findPagesByTag(db, req.params.tag));
  });

  let isClosed = false;
  app.locals.close = () => {
    if (isClosed) return;
    isClosed = true;
    db.close();
  };
  return app;
}
