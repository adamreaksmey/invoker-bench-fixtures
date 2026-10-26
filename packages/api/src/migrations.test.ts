import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { AuthStore } from "./auth-store";
import { MIGRATIONS, currentSchemaVersion, runMigrations } from "./migrations";

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
const EXPECTED_TABLES = ["users", "sessions", "accounts", "transactions", "schema_migrations"];

function tableNames(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("runMigrations", () => {
  let db: DatabaseSync | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("applies all migrations on an empty database", () => {
    db = new DatabaseSync(":memory:");
    expect(runMigrations(db)).toEqual(MIGRATIONS.map(({ version }) => version));
    expect(tableNames(db)).toEqual(expect.arrayContaining(EXPECTED_TABLES));
    expect(currentSchemaVersion(db)).toBe(LATEST_VERSION);
  });

  it("is idempotent when run again", () => {
    db = new DatabaseSync(":memory:");
    runMigrations(db);
    expect(runMigrations(db)).toEqual([]);
    expect(currentSchemaVersion(db)).toBe(LATEST_VERSION);
  });

  it("upgrades a pre-migration database that already has auth tables", async () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(MIGRATIONS[0].sql);
    const store = new AuthStore(db, () => 1000);
    await store.createUser("legacy", "passphrase");

    runMigrations(db);

    expect(store.findUserByUsername("legacy")?.username).toBe("legacy");
    expect(tableNames(db)).toContain("accounts");
    expect(tableNames(db)).toContain("transactions");
    expect(currentSchemaVersion(db)).toBe(LATEST_VERSION);
  });

  it("rolls back a failing migration and records nothing for it", () => {
    db = new DatabaseSync(":memory:");
    const broken = {
      version: 1,
      name: "broken",
      sql: "CREATE TABLE ok_table (id INTEGER); SELECT * FROM missing_table_xyz;",
    };
    expect(() => runMigrations(db!, [broken])).toThrow();
    expect(tableNames(db)).not.toContain("ok_table");
    expect(currentSchemaVersion(db)).toBe(0);
  });
});
