import express from "express";
import { randomBytes } from "node:crypto";
import { openDatabase } from "./database.js";
import { createLinkRepository } from "./link-repository.js";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const JSON_BODY_LIMIT = "16kb";
const DEFAULT_DATABASE_PATH = "shortener.sqlite";
const MAX_CODE_ATTEMPTS = 10;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_FOUND = 302;
const NOT_FOUND_ERROR = "link not found";
const MISSING_URL_ERROR = "url is required";
const CONFLICTING_CODE_ERROR = "code already exists";

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function createUniqueCode(repository) {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const candidateCode = generateCode();
    if (!repository.hasCode(candidateCode)) return candidateCode;
  }
  throw new Error("could not generate a unique short code");
}

function resolveRequestedCode(req, repository) {
  const requestedCode = req.body?.code;
  return typeof requestedCode === "string" ? requestedCode : createUniqueCode(repository);
}

function handleCreateLink(req, res, { linkRepository, now }) {
  const url = req.body?.url;
  if (typeof url !== "string" || url.length === 0) {
    return res.status(HTTP_BAD_REQUEST).json({ error: MISSING_URL_ERROR });
  }
  const code = resolveRequestedCode(req, linkRepository);
  if (linkRepository.hasCode(code)) {
    return res.status(HTTP_CONFLICT).json({ error: CONFLICTING_CODE_ERROR });
  }
  const link = linkRepository.create({ code, url, createdAtMs: now() });
  return res.status(201).json({ code: link.code, url: link.url, shortUrl: `/${link.code}` });
}

function handleReadLink(req, res, { linkRepository }) {
  const link = linkRepository.findByCode(req.params.code);
  if (!link) return res.status(HTTP_NOT_FOUND).json({ error: NOT_FOUND_ERROR });
  return res.json(link);
}

function handleRedirect(req, res, { linkRepository }) {
  const link = linkRepository.findByCode(req.params.code);
  if (!link) return res.status(HTTP_NOT_FOUND).json({ error: NOT_FOUND_ERROR });
  return res.redirect(HTTP_FOUND, link.url);
}

function registerRoutes(app, dependencies) {
  app.post("/links", (req, res) => handleCreateLink(req, res, dependencies));
  app.get("/links/:code", (req, res) => handleReadLink(req, res, dependencies));
  app.get("/:code", (req, res) => handleRedirect(req, res, dependencies));
}

function createCloseHook(database) {
  let isClosed = false;
  return () => {
    if (isClosed) return;
    isClosed = true;
    database.close();
  };
}

function resolveDatabasePath(options) {
  return options.databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

export function createApp(options = {}) {
  const database = openDatabase(resolveDatabasePath(options));
  const dependencies = {
    linkRepository: createLinkRepository(database),
    now: options.now ?? (() => Date.now()),
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  registerRoutes(app, dependencies);
  app.locals.close = createCloseHook(database);
  return app;
}
