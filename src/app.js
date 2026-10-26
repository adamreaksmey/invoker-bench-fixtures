import express from "express";
import { randomBytes } from "node:crypto";
import { findLinkByCode, insertLink, openDatabase } from "./db.js";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEFAULT_DATABASE_PATH = "shortener.sqlite";
const JSON_BODY_LIMIT = "16kb";

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function resolveDatabasePath(options) {
  if (typeof options.databasePath === "string") return options.databasePath;
  return process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

export function createApp(options = {}) {
  const database = openDatabase(resolveDatabasePath(options));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.post("/links", (req, res) => {
    const url = req.body?.url;
    if (typeof url !== "string" || url.length === 0) {
      return res.status(400).json({ error: "url is required" });
    }
    const code = typeof req.body.code === "string" ? req.body.code : generateCode();
    const link = { code, url, createdAt: new Date().toISOString() };
    insertLink(database, link);
    return res.status(201).json({ code, url, shortUrl: `/${code}` });
  });

  app.get("/links/:code", (req, res) => {
    const link = findLinkByCode(database, req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.json(link);
  });

  app.get("/:code", (req, res) => {
    const link = findLinkByCode(database, req.params.code);
    if (!link) return res.status(404).json({ error: "link not found" });
    return res.redirect(302, link.url);
  });

  app.locals.close = () => {
    database.close();
  };
  return app;
}
