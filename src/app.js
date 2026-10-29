import express from "express";
import { randomBytes } from "node:crypto";
import { openDatabase } from "./database.js";
import { createClickRepository } from "./click-repository.js";
import { createLinkRepository } from "./link-repository.js";
import { createFixedWindowRateLimiter } from "./rate-limiter.js";
import { isValidAbsoluteHttpUrl, isValidCustomCode } from "./validation.js";

const CODE_LENGTH = 6;
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const JSON_BODY_LIMIT = "16kb";
const DEFAULT_DATABASE_PATH = "shortener.sqlite";
const MAX_CODE_ATTEMPTS = 10;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_FOUND = 302;
const NOT_FOUND_ERROR = "link not found";
const MISSING_URL_ERROR = "url is required";
const INVALID_URL_ERROR = "url must be an absolute http or https URL";
const INVALID_CODE_ERROR = "code must match ^[A-Za-z0-9_-]{3,32}$";
const CONFLICTING_CODE_ERROR = "code already exists";
const RATE_LIMIT_ERROR = "too many link creation requests, retry later";
const INVALID_BODY_ERROR = "request body must be valid JSON";
const BODY_TOO_LARGE_ERROR = "request body is too large";
const INTERNAL_ERROR = "internal server error";
const BODY_ERROR_TYPES = new Map([
  ["entity.parse.failed", INVALID_BODY_ERROR],
  ["entity.too.large", BODY_TOO_LARGE_ERROR],
]);
const MINIMUM_CLIENT_ERROR_STATUS = 400;
const MAXIMUM_CLIENT_ERROR_STATUS = 499;
const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const RETRY_AFTER_HEADER = "Retry-After";

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

function handleCreateLink(req, res, { linkRepository, rateLimiter, now }) {
  const rateLimit = rateLimiter.check(req.ip);
  if (rateLimit.isLimited) {
    res.set(RETRY_AFTER_HEADER, String(rateLimit.retryAfterSeconds));
    return res.status(HTTP_TOO_MANY_REQUESTS).json({ error: RATE_LIMIT_ERROR });
  }
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

function isClientErrorStatus(status) {
  return status >= MINIMUM_CLIENT_ERROR_STATUS && status <= MAXIMUM_CLIENT_ERROR_STATUS;
}

function resolveErrorResponse(error) {
  if (!isClientErrorStatus(error?.status)) {
    return { status: HTTP_INTERNAL_SERVER_ERROR, message: INTERNAL_ERROR };
  }
  return {
    status: error.status,
    message: BODY_ERROR_TYPES.get(error.type) ?? INVALID_BODY_ERROR,
  };
}

function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  const { status, message } = resolveErrorResponse(error);
  return res.status(status).json({ error: message });
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

function parseEnvironmentNumber(environmentValue, fallbackValue) {
  const parsedValue = Number(environmentValue);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
}

function resolveRateLimitMax(options) {
  if (options.rateLimitMax !== undefined) return options.rateLimitMax;
  return parseEnvironmentNumber(process.env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
}

function resolveRateLimitWindowMs(options) {
  if (options.rateLimitWindowMs !== undefined) return options.rateLimitWindowMs;
  return parseEnvironmentNumber(
    process.env.RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
}

function resolveNow(options) {
  return options.now ?? (() => Date.now());
}

export function createApp(options = {}) {
  const database = openDatabase(resolveDatabasePath(options));
  const now = resolveNow(options);
  const dependencies = {
    linkRepository: createLinkRepository(database),
    clickRepository: createClickRepository(database),
    rateLimiter: createFixedWindowRateLimiter({
      max: resolveRateLimitMax(options),
      windowMs: resolveRateLimitWindowMs(options),
      now,
    }),
    now,
  };
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  registerRoutes(app, dependencies);
  app.use(handleError);
  app.locals.close = createCloseHook(database);
  return app;
}
