import express from "express";
import {
  SLUG_PATTERN,
  deletePage,
  listSlugs,
  readPage,
  readPageWithMeta,
  writePage,
} from "./pages.js";
import { openWikiIndex } from "./wiki-index.js";

const DEFAULT_INDEX_PATH = process.env.WIKI_INDEX_PATH ?? "wiki-index.sqlite";
const BLANK_QUERY_ERROR = "query is required";

function requireValidSlug(req, res, next) {
  if (!SLUG_PATTERN.test(req.params.slug)) {
    return res.status(400).json({ error: "invalid slug" });
  }
  return next();
}

function toPageResponse(page) {
  return {
    slug: page.slug,
    title: page.title,
    tags: page.tags,
    body: page.body,
  };
}

function listPageSummaries(pagesDir) {
  return listSlugs(pagesDir).map((slug) => {
    const page = readPage(pagesDir, slug);
    return { slug: page.slug, title: page.title, tags: page.tags };
  });
}

function registerPageRoutes(app, pagesDir, wikiIndex) {
  app.get("/pages", (_req, res) => {
    res.json(listPageSummaries(pagesDir));
  });

  app.get("/pages/:slug", requireValidSlug, (req, res) => {
    const page = readPage(pagesDir, req.params.slug);
    if (!page) return res.status(404).json({ error: "page not found" });
    return res.json(toPageResponse(page));
  });

  app.put("/pages/:slug", requireValidSlug, (req, res) => {
    const body = req.body?.body;
    if (typeof body !== "string") {
      return res.status(400).json({ error: "body must be a string" });
    }
    const existed = writePage(pagesDir, req.params.slug, body);
    const page = readPageWithMeta(pagesDir, req.params.slug);
    wikiIndex.indexPage(page, page.mtimeMs);
    return res.status(existed ? 200 : 201).json(toPageResponse(page));
  });

  app.delete("/pages/:slug", requireValidSlug, (req, res) => {
    if (!deletePage(pagesDir, req.params.slug)) {
      return res.status(404).json({ error: "page not found" });
    }
    wikiIndex.removePage(req.params.slug);
    return res.status(204).end();
  });
}

function registerSearchAndTagRoutes(app, wikiIndex) {
  app.get("/search", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (query.trim() === "") {
      return res.status(400).json({ error: BLANK_QUERY_ERROR });
    }
    return res.json({ query, results: wikiIndex.search(query) });
  });

  app.get("/tags", (_req, res) => {
    res.json(wikiIndex.listTags());
  });

  app.get("/tags/:tag", (req, res) => {
    res.json(wikiIndex.pagesForTag(req.params.tag));
  });
}

export function createApp(options = {}) {
  const pagesDir = options.pagesDir;
  if (!pagesDir) throw new TypeError("pagesDir is required");
  const indexPath = options.indexPath ?? DEFAULT_INDEX_PATH;
  const wikiIndex = openWikiIndex(indexPath);
  wikiIndex.syncFromDirectory(pagesDir);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  registerPageRoutes(app, pagesDir, wikiIndex);
  registerSearchAndTagRoutes(app, wikiIndex);
  app.locals.close = () => {
    wikiIndex.close();
  };
  return app;
}
