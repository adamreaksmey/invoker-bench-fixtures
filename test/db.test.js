import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.js";

const TEMP_DIR_PREFIX = "shortener-db-";
const DATABASE_FILENAME = "migrations.sqlite";
const EXPECTED_MIGRATION_VERSIONS = [1, 2];

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
  return join(directory, DATABASE_FILENAME);
}

function listMigrationVersions(database) {
  return database
    .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
    .all()
    .map((row) => row.version);
}

function tableExists(database, tableName) {
  const row = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(tableName);
  return row !== undefined;
}

test("openDatabase applies versioned migrations and records each version", () => {
  const databasePath = temporaryDatabasePath();
  const database = openDatabase(databasePath);
  try {
    assert.deepEqual(listMigrationVersions(database), EXPECTED_MIGRATION_VERSIONS);
    assert.equal(tableExists(database, "links"), true);
    assert.equal(tableExists(database, "clicks"), true);
    assert.equal(tableExists(database, "schema_migrations"), true);
  } finally {
    database.close();
  }
});

test("reopening the same database file does not re-apply migrations", () => {
  const databasePath = temporaryDatabasePath();

  const first = openDatabase(databasePath);
  try {
    assert.deepEqual(listMigrationVersions(first), EXPECTED_MIGRATION_VERSIONS);
  } finally {
    first.close();
  }

  const second = openDatabase(databasePath);
  try {
    assert.deepEqual(listMigrationVersions(second), EXPECTED_MIGRATION_VERSIONS);
    assert.equal(tableExists(second, "links"), true);
    assert.equal(tableExists(second, "clicks"), true);
  } finally {
    second.close();
  }
});
