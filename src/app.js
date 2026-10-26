import express from "express";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const MIGRATIONS = [{ version: 1, sql: `
  CREATE TABLE links (code TEXT PRIMARY KEY, url TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL REFERENCES links(code) ON DELETE CASCADE,
    clicked_at INTEGER NOT NULL,
    referer TEXT
  );
  CREATE INDEX clicks_code_clicked_at ON clicks(code, clicked_at);
` }];

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function migrate(database) {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    database.exec("BEGIN");
    try {
      database.exec(migration.sql);
      database.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(migration.version);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function isValidUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createApp(options = {}) {
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? "shortener.sqlite";
  const rateLimitMax = Number(options.rateLimitMax ?? process.env.RATE_LIMIT_MAX ?? 20);
  const rateLimitWindowMs = Number(options.rateLimitWindowMs ?? process.env.RATE_LIMIT_WINDOW_MS ?? 60000);
  const now = options.now ?? (() => Date.now());
  const database = new DatabaseSync(databasePath);
  migrate(database);
  const app = express();
  const rateLimits = new Map();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.post("/links", (req, res) => {
    const currentTime = now();
    const client = req.ip;
    const previous = rateLimits.get(client);
    const windowStart = previous && currentTime - previous.startedAt < rateLimitWindowMs ? previous.startedAt : currentTime;
    const count = previous && windowStart === previous.startedAt ? previous.count : 0;
    if (count >= rateLimitMax) {
      const retryAfter = Math.max(1, Math.ceil((windowStart + rateLimitWindowMs - currentTime) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "rate limit exceeded" });
    }
    rateLimits.set(client, { startedAt: windowStart, count: count + 1 });

    const url = req.body?.url;
    if (!isValidUrl(url)) return res.status(400).json({ error: "url must be an absolute http or https URL" });
    const requestedCode = req.body?.code;
    if (requestedCode !== undefined && (typeof requestedCode !== "string" || !CODE_PATTERN.test(requestedCode))) {
      return res.status(400).json({ error: "code must be 3-32 letters, numbers, underscores, or hyphens" });
    }
    let code = requestedCode ?? generateCode();
    if (requestedCode !== undefined && database.prepare("SELECT 1 FROM links WHERE code = ?").get(code)) {
      return res.status(409).json({ error: "code already exists" });
    }
    if (requestedCode === undefined) {
      while (database.prepare("SELECT 1 FROM links WHERE code = ?").get(code)) code = generateCode();
    }
    const createdAt = new Date(currentTime).toISOString();
    database.prepare("INSERT INTO links (code, url, created_at) VALUES (?, ?, ?)").run(code, url, createdAt);
    return res.status(201).json({ code, url, shortUrl: `/${code}` });
  });

  app.get("/links/:code/stats", (req, res) => {
    const link = database.prepare("SELECT code, url FROM links WHERE code = ?").get(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    const summary = database.prepare("SELECT COUNT(*) AS total, MAX(clicked_at) AS last_clicked_at FROM clicks WHERE code = ?").get(req.params.code);
    const daily = database.prepare("SELECT strftime('%Y-%m-%d', clicked_at / 1000, 'unixepoch') AS day, COUNT(*) AS count FROM clicks WHERE code = ? GROUP BY day ORDER BY day").all(req.params.code);
    return res.json({
      code: link.code,
      url: link.url,
      totalClicks: summary.total,
      lastClickedAt: summary.last_clicked_at === null ? null : new Date(summary.last_clicked_at).toISOString(),
      clicksByDay: Object.fromEntries(daily.map((row) => [row.day, row.count])),
    });
  });

  app.get("/links/:code", (req, res) => {
    const link = database.prepare("SELECT code, url, created_at AS createdAt FROM links WHERE code = ?").get(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.json(link);
  });

  app.get("/:code", (req, res) => {
    const link = database.prepare("SELECT url FROM links WHERE code = ?").get(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    database.prepare("INSERT INTO clicks (code, clicked_at, referer) VALUES (?, ?, ?)").run(req.params.code, now(), req.get("referer") ?? null);
    return res.redirect(302, link.url);
  });

  let closed = false;
  app.locals.close = () => {
    if (!closed) {
      closed = true;
      database.close();
    }
  };
  return app;
}
