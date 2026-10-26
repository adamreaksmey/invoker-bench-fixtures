import { DatabaseSync } from "node:sqlite";

const SCHEMA_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL
  )
`;

const MIGRATIONS = [
  {
    version: 1,
    up(database) {
      database.exec(`
        CREATE TABLE links (
          code TEXT PRIMARY KEY NOT NULL,
          url TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE clicks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL REFERENCES links(code),
          clicked_at TEXT NOT NULL,
          referer TEXT
        );
        CREATE INDEX clicks_code_idx ON clicks(code);
      `);
    },
  },
];

export function openDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  runMigrations(database);
  return database;
}

export function runMigrations(database) {
  database.exec(SCHEMA_MIGRATIONS_TABLE);
  const selectApplied = database.prepare("SELECT version FROM schema_migrations");
  const insertVersion = database.prepare(
    "INSERT INTO schema_migrations (version) VALUES (?)",
  );
  const appliedVersions = new Set(selectApplied.all().map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    migration.up(database);
    insertVersion.run(migration.version);
  }
}
