import express from "express";
import { randomBytes } from "node:crypto";
import { openDatabase } from "./database.js";
import { createClickRepository } from "./click-repository.js";
import { createLinkRepository } from "./link-repository.js";
import { isValidAbsoluteHttpUrl, isValidCustomCode } from "./validation.js";

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
const INVALID_URL_ERROR = "url must be an absolute http or https URL";
const INVALID_CODE_ERROR = "code must match ^[A-Za-z0-9_-]{3,32}$";
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

function hasRequestedCode(req) {
  return req.body?.code !== undefined && req.body?.code !== null;
}

function validateUrl(url) {
  if (typeof url !== "string" || url.length === 0) return MISSING_URL_ERROR;
  return isValidAbsoluteHttpUrl(url) ? null : INVALID_URL_ERROR;
}

function validateCode(req) {
  return hasRequestedCode(req) && !isValidCustomCode(req.body.code) ? INVALID_CODE_ERROR : null;
}

function resolveRequestedCode(req, repository) {
  return hasRequestedCode(req) ? req.body.code : createUniqueCode(repository);
}

function handleCreateLink(req, res, { linkRepository, now }) {
  const url = req.body?.url;
  const validationError = validateUrl(url) ?? validateCode(req);
  if (validationError) return res.status(HTTP_BAD_REQUEST).json({ error: validationError });
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

function handleRedirect(req, res, { linkRepository, clickRepository, now }) {
  const link = linkRepository.findByCode(req.params.code);
  if (!link) return res.status(HTTP_NOT_FOUND).json({ error: NOT_FOUND_ERROR });
  clickRepository.record({
    code: link.code,
    clickedAtMs: now(),
    referer: req.get("referer") ?? null,
  });
  return res.redirect(HTTP_FOUND, link.url);
}

function handleReadStats(req, res, { linkRepository, clickRepository }) {
  const link = linkRepository.findByCode(req.params.code);
  if (!link) return res.status(HTTP_NOT_FOUND).json({ error: NOT_FOUND_ERROR });
  const summary = clickRepository.summarize(link.code);
  return res.json({
    code: link.code,
    url: link.url,
    totalClicks: summary.totalClicks,
    lastClickedAt: summary.lastClickedAt,
    clicksByDay: summary.clicksByDay,
  });
}

function registerRoutes(app, dependencies) {
  app.post("/links", (req, res) => handleCreateLink(req, res, dependencies));
  app.get("/links/:code/stats", (req, res) => handleReadStats(req, res, dependencies));
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
    clickRepository: createClickRepository(database),
    now: options.now ?? (() => Date.now()),
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  registerRoutes(app, dependencies);
  app.locals.close = createCloseHook(database);
  return app;
}
