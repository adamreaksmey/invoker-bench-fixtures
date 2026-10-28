import express from "express";
import { randomBytes } from "node:crypto";
import { ShortenerDatabase } from "./database.js";
import { RateLimiter } from "./rate-limiter.js";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CUSTOM_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const MAX_CODE_GENERATION_ATTEMPTS = 10;
const DEFAULT_DATABASE_PATH = "shortener.sqlite";
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
const JSON_BODY_LIMIT = "16kb";

export function createApp(options = {}) {
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const rateLimitMax = options.rateLimitMax ?? Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX);
  const rateLimitWindowMs = options.rateLimitWindowMs ?? Number(process.env.RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS);
  const now = options.now ?? (() => Date.now());

  const database = new ShortenerDatabase(databasePath);
  const rateLimiter = new RateLimiter({ maxRequests: rateLimitMax, windowMs: rateLimitWindowMs, now });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.post("/links", handleCreateLink({ database, rateLimiter, now }));
  app.get("/links/:code", handleGetLink({ database }));
  app.get("/links/:code/stats", handleGetStats({ database }));
  app.get("/:code", handleRedirect({ database, now }));

  app.locals.close = () => database.close();
  return app;
}

function handleCreateLink({ database, rateLimiter, now }) {
  return (req, res) => {
    const rateLimitResult = rateLimiter.isAllowed(req.ip);
    if (!rateLimitResult.allowed) {
      res.setHeader("Retry-After", String(rateLimitResult.retryAfterSeconds));
      return res.status(429).json({ error: "rate limit exceeded" });
    }

    const urlValidation = validateUrl(req.body?.url);
    if (!urlValidation.valid) return res.status(400).json({ error: urlValidation.error });

    const requestedCode = req.body?.code;
    const isCustomCode = typeof requestedCode === "string";
    if (isCustomCode && !CUSTOM_CODE_PATTERN.test(requestedCode)) {
      return res.status(400).json({ error: "code must be 3-32 alphanumeric, hyphen, or underscore characters" });
    }

    const code = isCustomCode ? requestedCode : generateUniqueCode(database);
    const createdAt = new Date(now()).toISOString();
    const result = database.createLink(code, urlValidation.url, createdAt);
    if (!result.success) return res.status(409).json({ error: "code already exists" });

    return res.status(201).json({ code, url: urlValidation.url, shortUrl: `/${code}` });
  };
}

function handleGetLink({ database }) {
  return (req, res) => {
    const link = database.getLinkByCode(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.json({ code: link.code, url: link.url, createdAt: link.created_at });
  };
}

function handleGetStats({ database }) {
  return (req, res) => {
    const link = database.getLinkByCode(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    const stats = database.getClickStats(req.params.code);
    return res.json({
      code: link.code,
      url: link.url,
      totalClicks: stats.totalClicks,
      lastClickedAt: stats.lastClickedAt,
      clicksByDay: stats.clicksByDay,
    });
  };
}

function handleRedirect({ database, now }) {
  return (req, res) => {
    const link = database.getLinkByCode(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    const clickedAt = new Date(now()).toISOString();
    const referer = req.headers.referer ?? null;
    database.recordClick(link.code, clickedAt, referer);
    return res.redirect(302, link.url);
  };
}

function validateUrl(url) {
  if (typeof url !== "string" || url.length === 0) return { valid: false, error: "url is required" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "url must be an absolute http or https URL" };
    }
    return { valid: true, url };
  } catch {
    return { valid: false, error: "url must be an absolute http or https URL" };
  }
}

function generateUniqueCode(database) {
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateRandomCode();
    if (!database.getLinkByCode(code)) return code;
  }
  throw new Error("failed to generate unique code");
}

function generateRandomCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}
