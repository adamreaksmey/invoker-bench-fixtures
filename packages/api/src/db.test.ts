import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { currentSchemaVersion, openDatabase, runMigrations } from "./db";

describe("database migrations", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("applies versioned migrations on a fresh database", () => {
    const db = openDatabase(":memory:");
    expect(currentSchemaVersion(db)).toBe(2);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(["accounts", "schema_version", "sessions", "transactions", "users"]),
    );
    db.close();
  });

  it("keeps existing auth tables and upgrades them to the ledger schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-migrate-"));
    dirs.push(dir);
    const path = join(dir, "legacy.sqlite");

    const legacy = new DatabaseSync(path);
    legacy.exec("PRAGMA foreign_keys = ON");
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    legacy.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
      "user-1",
      "alice",
      "hash",
      1,
    );
    legacy.close();

    const upgraded = openDatabase(path);
    expect(currentSchemaVersion(upgraded)).toBe(2);
    const user = upgraded.prepare("SELECT username FROM users WHERE id = ?").get("user-1") as {
      username: string;
    };
    expect(user.username).toBe("alice");
    upgraded
      .prepare("INSERT INTO accounts (user_id, id, name) VALUES (?, ?, ?)")
      .run("user-1", "checking", "Checking");
    expect(
      (upgraded.prepare("SELECT name FROM accounts WHERE user_id = ?").get("user-1") as { name: string })
        .name,
    ).toBe("Checking");
    upgraded.close();
  });

  it("is idempotent when migrations have already been applied", () => {
    const db = openDatabase(":memory:");
    const before = currentSchemaVersion(db);
    runMigrations(db);
    expect(currentSchemaVersion(db)).toBe(before);
    db.close();
  });
});
