import express from "express";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host.length > 0;
  } catch {
    return false;
  }
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const migrations = [
    {
      version: 1,
      apply() {
        database.exec(`
          CREATE TABLE IF NOT EXISTS links (
            code TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            created_at TEXT NOT NULL
          )
        `);
      },
    },
  ];

  const hasMigration = database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );

  database.exec("BEGIN");
  try {
    for (const migration of migrations) {
      if (hasMigration.get(migration.version)) continue;
      migration.apply();
      recordMigration.run(migration.version, new Date().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function createApp(options = {}) {
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? "shortener.sqlite";
  const database = new DatabaseSync(databasePath);
  migrate(database);

  const insertLink = database.prepare(
    "INSERT INTO links (code, url, created_at) VALUES (?, ?, ?)",
  );
  const findLink = database.prepare(
    "SELECT code, url, created_at AS createdAt FROM links WHERE code = ?",
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.post("/links", (req, res) => {
    const body = req.body ?? {};
    const url = body.url;
    if (!isHttpUrl(url)) return res.status(400).json({ error: "url must be an absolute http or https URL" });

    const hasCustomCode = Object.hasOwn(body, "code");
    if (hasCustomCode && (typeof body.code !== "string" || !/^[A-Za-z0-9_-]{3,32}$/.test(body.code))) {
      return res.status(400).json({ error: "code must contain 3-32 letters, numbers, underscores, or hyphens" });
    }

    const code = hasCustomCode ? body.code : generateCode();
    if (hasCustomCode && findLink.get(code)) {
      return res.status(409).json({ error: "custom code already exists" });
    }
    const createdAt = new Date().toISOString();
    insertLink.run(code, url, createdAt);
    return res.status(201).json({ code, url, shortUrl: `/${code}` });
  });

  app.get("/links/:code", (req, res) => {
    const link = findLink.get(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.json(link);
  });

  app.get("/:code", (req, res) => {
    const link = findLink.get(req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.redirect(302, link.url);
  });

  app.locals.close = () => database.close();
  return app;
}
