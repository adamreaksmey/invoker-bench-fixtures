import { DatabaseSync } from "node:sqlite";

const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";
const LINKS_TABLE = "links";

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE ${LINKS_TABLE} (
        code TEXT PRIMARY KEY NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
];

function ensureMigrationsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY NOT NULL
    );
  `);
}

function appliedVersions(database) {
  const rows = database
    .prepare(`SELECT version FROM ${SCHEMA_MIGRATIONS_TABLE}`)
    .all();
  return new Set(rows.map((row) => row.version));
}

function applyMigration(database, migration) {
  database.exec("BEGIN");
  try {
    database.exec(migration.sql);
    database
      .prepare(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version) VALUES (?)`)
      .run(migration.version);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function runMigrations(database) {
  ensureMigrationsTable(database);
  const applied = appliedVersions(database);
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    applyMigration(database, migration);
  }
}

export function openDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  runMigrations(database);
  return database;
}

export function insertLink(database, link) {
  database
    .prepare(
      `INSERT INTO ${LINKS_TABLE} (code, url, created_at) VALUES (?, ?, ?)`,
    )
    .run(link.code, link.url, link.createdAt);
}

export function findLinkByCode(database, code) {
  const row = database
    .prepare(
      `SELECT code, url, created_at AS createdAt FROM ${LINKS_TABLE} WHERE code = ?`,
    )
    .get(code);
  return row ?? null;
}
