import { DatabaseSync } from "node:sqlite";

const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";
const LINKS_TABLE = "links";
const CLICKS_TABLE = "clicks";
const UTC_DATE_LENGTH = 10;

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
  {
    version: 2,
    sql: `
      CREATE TABLE ${CLICKS_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        clicked_at INTEGER NOT NULL,
        referer TEXT,
        FOREIGN KEY (code) REFERENCES ${LINKS_TABLE}(code)
      );
      CREATE INDEX clicks_code_clicked_at_idx
        ON ${CLICKS_TABLE} (code, clicked_at);
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

export function insertClick(database, click) {
  database
    .prepare(
      `INSERT INTO ${CLICKS_TABLE} (code, clicked_at, referer) VALUES (?, ?, ?)`,
    )
    .run(click.code, click.clickedAt, click.referer);
}

function utcDateKey(epochMs) {
  return new Date(epochMs).toISOString().slice(0, UTC_DATE_LENGTH);
}

function buildClicksByDay(clickedAtValues) {
  const clicksByDay = {};
  for (const clickedAt of clickedAtValues) {
    const day = utcDateKey(clickedAt);
    clicksByDay[day] = (clicksByDay[day] ?? 0) + 1;
  }
  return clicksByDay;
}

export function getLinkStats(database, code) {
  const link = findLinkByCode(database, code);
  if (!link) return null;

  const rows = database
    .prepare(
      `SELECT clicked_at AS clickedAt FROM ${CLICKS_TABLE}
       WHERE code = ? ORDER BY clicked_at ASC`,
    )
    .all(code);

  const clickedAtValues = rows.map((row) => row.clickedAt);
  const totalClicks = clickedAtValues.length;
  const lastClickedAt =
    totalClicks === 0
      ? null
      : new Date(clickedAtValues[totalClicks - 1]).toISOString();

  return {
    code: link.code,
    url: link.url,
    totalClicks,
    lastClickedAt,
    clicksByDay: buildClicksByDay(clickedAtValues),
  };
}
