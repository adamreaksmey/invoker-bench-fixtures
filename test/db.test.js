import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, runMigrations } from "../src/db.js";
import { tempDatabasePath } from "./helpers.js";

test("migration runner records versions and is idempotent", () => {
  const databasePath = tempDatabasePath();
  const first = openDatabase(databasePath);
  const versions = first.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(versions.map((row) => row.version), [1]);
  first.close();

  const second = openDatabase(databasePath);
  const again = second.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(again.map((row) => row.version), [1]);
  const linkCount = second.prepare("SELECT COUNT(*) AS count FROM links").get().count;
  assert.equal(linkCount, 0);
  second.close();
});

test("runMigrations can be applied to an open database", () => {
  const database = new DatabaseSync(":memory:");
  runMigrations(database);
  runMigrations(database);
  const versions = database.prepare("SELECT version FROM schema_migrations").all();
  assert.equal(versions.length, 1);
  database.close();
});
