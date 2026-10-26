import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { latestSchemaVersion, runMigrations } from "./migrations";
import { openDatabase } from "./db";

describe("database migrations", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => db?.close());

  it("creates the auth and user-scoped ledger schema on an empty database", () => {
    db = openDatabase(":memory:");

    expect(db.prepare("SELECT version FROM schema_version").get()).toEqual({ version: latestSchemaVersion });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all())
      .toEqual([
        { name: "accounts" },
        { name: "schema_version" },
        { name: "sessions" },
        { name: "transactions" },
        { name: "users" },
      ]);

    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run("user-1", "alice", "hash", 1);
    db.prepare("INSERT INTO accounts (user_id, id, name) VALUES (?, ?, ?)")
      .run("user-1", "checking", "Checking");
    db.prepare("INSERT INTO transactions (user_id, id, account_id, amount_cents, description) VALUES (?, ?, ?, ?, ?)")
      .run("user-1", "payday", "checking", 1250, "Payday");

    expect(() => db!.prepare("INSERT INTO transactions (user_id, id, account_id, amount_cents) VALUES (?, ?, ?, ?)")
      .run("user-1", "unknown-account", "missing", 1)).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("keeps an existing auth database compatible while adding ledger tables", () => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE sessions (token TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    `);

    runMigrations(db);

    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'sessions', 'accounts', 'transactions') ORDER BY name").all())
      .toEqual([{ name: "accounts" }, { name: "sessions" }, { name: "transactions" }, { name: "users" }]);
    expect(db.prepare("SELECT version FROM schema_version").get()).toEqual({ version: latestSchemaVersion });
  });
});
