import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db";

describe("database migrations", () => {
  let db: DatabaseSync | undefined;
  afterEach(() => { db?.close(); db = undefined; });

  it("applies the initial schema cleanly to an empty database", () => {
    db = openDatabase(":memory:");

    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all())
      .toEqual([{ version: 1 }]);
    expect(db.prepare("PRAGMA table_info(accounts)").all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "user_id", notnull: 1 }),
      expect.objectContaining({ name: "id", notnull: 1 }),
      expect.objectContaining({ name: "name", notnull: 1 }),
    ]));
    expect(db.prepare("PRAGMA table_info(transactions)").all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "user_id", notnull: 1 }),
      expect.objectContaining({ name: "account_id", notnull: 1 }),
      expect.objectContaining({ name: "amount_cents", notnull: 1 }),
    ]));
    expect(db.prepare("PRAGMA table_info(users)").all()).toHaveLength(4);
    expect(db.prepare("PRAGMA table_info(sessions)").all()).toHaveLength(4);
  });

  it("keeps existing auth tables and rows while applying migrations", () => {
    const directory = mkdtempSync(join(tmpdir(), "ledger-migrations-"));
    const filename = join(directory, "legacy.sqlite");
    try {
      db = new DatabaseSync(filename);
      db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE sessions (token TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
        INSERT INTO users VALUES ('u1', 'alice', 'hash', 1);`);
      db.close();
      db = openDatabase(filename);

      expect(db.prepare("SELECT username FROM users WHERE id = 'u1'").get()).toEqual({ username: "alice" });
      expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
    } finally {
      db?.close();
      db = undefined;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
