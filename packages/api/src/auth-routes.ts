import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { AuthStore, type StoredUser } from "./auth-store";

export const SESSION_COOKIE = "ledger_session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthenticatedRequest extends Request {
  user?: StoredUser;
}

export function createAuthRouter(store: AuthStore, secret: string) {
  const router = Router();

  router.post("/register", async (req, res, next) => {
    try {
      if (!isRecord(req.body) || typeof req.body.password !== "string") {
        return res.status(400).json({ error: "username and password are required" });
      }
      const user = await store.createUser(req.body.username, req.body.password);
      const session = store.createSession(user.id, SESSION_LIFETIME_MS);
      setSessionCookie(res, session.token, secret);
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message });
      if (isUniqueConstraint(error)) return res.status(409).json({ error: "username is already registered" });
      return next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      if (!isRecord(req.body) || typeof req.body.password !== "string") {
        return res.status(400).json({ error: "username and password are required" });
      }
      let user: StoredUser | undefined;
      try { user = await store.authenticate(req.body.username, req.body.password); }
      catch (error) {
        if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
      }
      if (!user) return res.status(401).json({ error: "invalid username or password" });
      const session = store.createSession(user.id, SESSION_LIFETIME_MS);
      setSessionCookie(res, session.token, secret);
      return res.json({ user: publicUser(user) });
    } catch (error) { return next(error); }
  });

  router.post("/logout", (req, res) => {
    const token = readSessionToken(req, secret);
    if (token) store.deleteSession(token);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return res.status(204).end();
  });

  router.get("/me", requireAuth(store, secret), (req: AuthenticatedRequest, res) => {
    return res.json({ user: publicUser(req.user!) });
  });
  return router;
}

export function requireAuth(store: AuthStore, secret: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = readSessionToken(req, secret);
    const session = token && store.findSession(token);
    const user = session && store.findUserById(session.userId);
    if (!user) return res.status(401).json({ error: "authentication required" });
    req.user = user;
    return next();
  };
}

function readSessionToken(req: Request, secret: string): string | undefined {
  const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!raw) return undefined;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return undefined;
  const token = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(token, secret);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) return undefined;
  return token;
}

function setSessionCookie(res: Response, token: string, secret: string) {
  res.cookie(SESSION_COOKIE, `${token}.${sign(token, secret)}`, {
    ...cookieOptions(), maxAge: SESSION_LIFETIME_MS,
  });
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const parsed: Record<string, string> = Object.create(null);
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    try { parsed[key] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return parsed;
}

function publicUser(user: StoredUser) { return { id: user.id, username: user.username }; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isUniqueConstraint(error: unknown) { return error instanceof Error && /UNIQUE constraint failed/.test(error.message); }
