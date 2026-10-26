import express from "express";
import { randomBytes } from "node:crypto";
import { findLinkByCode, insertLink, openDatabase } from "./db.js";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CUSTOM_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const DEFAULT_DATABASE_PATH = "shortener.sqlite";
const JSON_BODY_LIMIT = "16kb";

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function isAbsoluteHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === HTTP_PROTOCOL || parsed.protocol === HTTPS_PROTOCOL;
  } catch {
    return false;
  }
}

function resolveDatabasePath(options) {
  if (typeof options.databasePath === "string") return options.databasePath;
  return process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

function validateCreateLinkBody(body) {
  const url = body?.url;
  if (typeof url !== "string" || url.length === 0) {
    return { error: "url is required", status: 400 };
  }
  if (!isAbsoluteHttpUrl(url)) {
    return { error: "url must be an absolute http or https URL", status: 400 };
  }

  const hasCustomCode = typeof body.code === "string";
  if (hasCustomCode && !CUSTOM_CODE_PATTERN.test(body.code)) {
    return {
      error: "code must match ^[A-Za-z0-9_-]{3,32}$",
      status: 400,
    };
  }

  return {
    url,
    code: hasCustomCode ? body.code : generateCode(),
    hasCustomCode,
  };
}

export function createApp(options = {}) {
  const database = openDatabase(resolveDatabasePath(options));
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.post("/links", (req, res) => {
    const validated = validateCreateLinkBody(req.body);
    if (validated.error) {
      return res.status(validated.status).json({ error: validated.error });
    }

    const { url, code, hasCustomCode } = validated;
    if (hasCustomCode && findLinkByCode(database, code)) {
      return res.status(409).json({ error: "code already exists" });
    }

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
