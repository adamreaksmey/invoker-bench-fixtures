import { randomUUID } from "node:crypto";
import {
  createSessionToken,
  createUserId,
  createUsername,
  generateSessionToken,
  hashPassword,
  verifyPassword,
  type PasswordHash,
  type SessionToken,
  type UserId,
  type Username,
} from "../../core/src/auth";
import type { DatabaseSync } from "node:sqlite";

export interface StoredUser {
  id: UserId;
  username: Username;
  passwordHash: PasswordHash;
  createdAt: number;
}

export interface StoredSession {
  token: SessionToken;
  userId: UserId;
  expiresAt: number;
  createdAt: number;
}

type UserRow = { id: string; username: string; password_hash: string; created_at: number };
type SessionRow = { token: string; user_id: string; expires_at: number; created_at: number };

const USER_SELECT = "SELECT id, username, password_hash, created_at FROM users WHERE username = ?";
const USER_SELECT_BY_ID = "SELECT id, username, password_hash, created_at FROM users WHERE id = ?";
const SESSION_SELECT = "SELECT token, user_id, expires_at, created_at FROM sessions WHERE token = ?";

/** SQLite-backed credential and session persistence. Passwords are only stored as scrypt hashes. */
export class AuthStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}

  async createUser(usernameInput: unknown, password: string): Promise<StoredUser> {
    const username = createUsername(usernameInput);
    const passwordHash = await hashPassword(password);
    const user: StoredUser = {
      id: createUserId(randomUUID()),
      username,
      passwordHash,
      createdAt: this.now(),
    };
    this.db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(user.id, user.username, user.passwordHash, user.createdAt);
    return user;
  }

  findUserByUsername(usernameInput: unknown): StoredUser | undefined {
    const username = createUsername(usernameInput);
    const row = this.db.prepare(USER_SELECT).get(username) as UserRow | undefined;
    return row && toUser(row);
  }

  findUserById(idInput: unknown): StoredUser | undefined {
    const id = createUserId(idInput);
    const row = this.db.prepare(USER_SELECT_BY_ID).get(id) as UserRow | undefined;
    return row && toUser(row);
  }

  async authenticate(usernameInput: unknown, password: string): Promise<StoredUser | undefined> {
    const user = this.findUserByUsername(usernameInput);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return undefined;
    return user;
  }

  createSession(userIdInput: unknown, lifetimeMs: number): StoredSession {
    const userId = createUserId(userIdInput);
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) {
      throw new RangeError("Session lifetime must be a positive safe integer");
    }
    const createdAt = this.now();
    const session: StoredSession = {
      token: generateSessionToken(),
      userId,
      createdAt,
      expiresAt: createdAt + lifetimeMs,
    };
    this.db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(session.token, session.userId, session.expiresAt, session.createdAt);
    return session;
  }

  findSession(tokenInput: unknown): StoredSession | undefined {
    const token = createSessionToken(tokenInput);
    const row = this.db.prepare(SESSION_SELECT).get(token) as SessionRow | undefined;
    if (!row) return undefined;
    const session = toSession(row);
    return session.expiresAt > this.now() ? session : undefined;
  }

  deleteSession(tokenInput: unknown): boolean {
    const token = createSessionToken(tokenInput);
    return this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token).changes > 0;
  }

  deleteExpiredSessions(): number {
    return Number(this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(this.now()).changes);
  }
}

function toUser(row: UserRow): StoredUser {
  return {
    id: createUserId(row.id),
    username: createUsername(row.username),
    passwordHash: row.password_hash as PasswordHash,
    createdAt: Number(row.created_at),
  };
}

function toSession(row: SessionRow): StoredSession {
  return {
    token: createSessionToken(row.token),
    userId: createUserId(row.user_id),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
  };
}
