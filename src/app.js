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
    const url = req.body?.url;
    if (typeof url !== "string" || url.length === 0) return res.status(400).json({ error: "url is required" });
    const code = typeof req.body.code === "string" ? req.body.code : generateCode();
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
