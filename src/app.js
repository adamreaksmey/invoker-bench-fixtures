import express from "express";
import { openDatabase } from "./db.js";
import { createLinksRepository } from "./links.js";
import { createRateLimiter } from "./rate-limit.js";
import { isAbsoluteHttpUrl, isValidCustomCode } from "./validation.js";

const DEFAULT_DATABASE_PATH = "shortener.sqlite";
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

function resolveOptions(options = {}) {
  return {
    databasePath: options.databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
    rateLimitMax: options.rateLimitMax ?? Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX),
    rateLimitWindowMs:
      options.rateLimitWindowMs ??
      Number(process.env.RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS),
    now: options.now ?? (() => Date.now()),
  };
}

function toIsoTimestamp(epochMs) {
  return new Date(epochMs).toISOString();
}

function readReferer(headerValue) {
  if (typeof headerValue !== "string" || headerValue.length === 0) return null;
  return headerValue;
}

function resolveCreateCode(links, requestedCode) {
  if (requestedCode === undefined || requestedCode === null) {
    return { ok: true, code: links.allocateCode() };
  }
  if (!isValidCustomCode(requestedCode)) {
    return { ok: false, status: 400, error: "code must match ^[A-Za-z0-9_-]{3,32}$" };
  }
  if (links.codeExists(requestedCode)) {
    return { ok: false, status: 409, error: "code already exists" };
  }
  return { ok: true, code: requestedCode };
}

function registerRoutes(app, { links, checkRateLimit, now }) {
  app.post("/links", (req, res) => {
    const rateLimitResult = checkRateLimit(req.ip);
    if (rateLimitResult.limited) {
      res.set("Retry-After", String(rateLimitResult.retryAfterSeconds));
      return res.status(429).json({ error: "rate limit exceeded" });
    }

    const url = req.body?.url;
    if (!isAbsoluteHttpUrl(url)) {
      return res.status(400).json({ error: "url must be an absolute http or https URL" });
    }

    const codeResult = resolveCreateCode(links, req.body?.code);
    if (!codeResult.ok) {
      return res.status(codeResult.status).json({ error: codeResult.error });
    }

    const createdAt = toIsoTimestamp(now());
    links.createLink({ url, code: codeResult.code, createdAt });
    return res.status(201).json({ code: codeResult.code, url, shortUrl: `/${codeResult.code}` });
  });

  app.get("/links/:code/stats", (req, res) => {
    const stats = links.getStats(req.params.code);
    if (!stats) return res.status(404).json({ error: "link not found" });
    return res.json(stats);
  });

  app.get("/links/:code", (req, res) => {
    const link = links.findByCode(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.json(link);
  });

  app.get("/:code", (req, res) => {
    const link = links.findByCode(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    links.recordClick({
      code: link.code,
      clickedAt: toIsoTimestamp(now()),
      referer: readReferer(req.get("referer")),
    });
    return res.redirect(302, link.url);
  });
}

export function createApp(options = {}) {
  const { databasePath, rateLimitMax, rateLimitWindowMs, now } = resolveOptions(options);
  const database = openDatabase(databasePath);
  const links = createLinksRepository(database);
  const checkRateLimit = createRateLimiter({
    maxRequests: rateLimitMax,
    windowMs: rateLimitWindowMs,
    now,
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  registerRoutes(app, { links, checkRateLimit, now });
  app.locals.close = () => {
    database.close();
  };
  return app;
}
