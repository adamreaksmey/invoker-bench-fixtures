import express from "express";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  if (!applied.get(1)) {
    database.exec("BEGIN");
    try {
      database.exec(`
        CREATE TABLE links (
          code TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (1, CURRENT_TIMESTAMP);
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function createApp(options = {}) {
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? "shortener.sqlite";
  const database = new DatabaseSync(databasePath);
  migrate(database);
  const getLink = database.prepare("SELECT code, url, created_at AS createdAt FROM links WHERE code = ?");
  const saveLink = database.prepare("INSERT INTO links (code, url, created_at) VALUES (?, ?, ?)");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.post("/links", (req, res) => {
    const url = req.body?.url;
    if (typeof url !== "string" || url.length === 0) return res.status(400).json({ error: "url is required" });
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: "url must be an absolute http or https URL" });
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return res.status(400).json({ error: "url must be an absolute http or https URL" });
    }
    const hasCustomCode = req.body != null && Object.hasOwn(req.body, "code");
    if (hasCustomCode && (typeof req.body.code !== "string" || !/^[A-Za-z0-9_-]{3,32}$/.test(req.body.code))) {
      return res.status(400).json({ error: "code must be 3 to 32 characters using letters, numbers, hyphens, or underscores" });
    }
    const code = hasCustomCode ? req.body.code : generateCode();
    const createdAt = new Date().toISOString();
    try {
      saveLink.run(code, url, createdAt);
    } catch (error) {
      if (error.errcode === 1555 || error.errcode === 2067) {
        return res.status(409).json({ error: "code already exists" });
      }
      throw error;
    }
    return res.status(201).json({ code, url, shortUrl: `/${code}` });
  });

  app.get("/links/:code", (req, res) => {
    const link = getLink.get(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.json({ code: link.code, url: link.url, createdAt: link.createdAt });
  });

  app.get("/:code", (req, res) => {
    const link = getLink.get(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.redirect(302, link.url);
  });

  app.locals.close = () => database.close();
  return app;
}
