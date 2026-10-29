const CREATE_SCHEMA_MIGRATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

const RECORD_MIGRATION_SQL = "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)";
const SELECT_APPLIED_VERSIONS_SQL = "SELECT version FROM schema_migrations";

const CREATE_LINKS_TABLE_SQL = `
  CREATE TABLE links (
    code TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
  ) STRICT
`;

export const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    description: "create links table",
    up(database) {
      database.exec(CREATE_LINKS_TABLE_SQL);
    },
  }),
]);

function readAppliedVersions(database) {
  const rows = database.prepare(SELECT_APPLIED_VERSIONS_SQL).all();
  return new Set(rows.map((row) => row.version));
}

function applyMigration(database, migration, recordMigration) {
  database.exec("BEGIN IMMEDIATE");
  try {
    migration.up(database);
    recordMigration.run(migration.version, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function runMigrations(database, migrations) {
  database.exec(CREATE_SCHEMA_MIGRATIONS_SQL);
  const appliedVersions = readAppliedVersions(database);
  const recordMigration = database.prepare(RECORD_MIGRATION_SQL);
  const pendingMigrations = [...migrations]
    .sort((left, right) => left.version - right.version)
    .filter((migration) => !appliedVersions.has(migration.version));

  for (const migration of pendingMigrations) {
    applyMigration(database, migration, recordMigration);
  }
}
