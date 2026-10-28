const BEGIN_TRANSACTION_SQL = "BEGIN";
const COMMIT_TRANSACTION_SQL = "COMMIT";
const ROLLBACK_TRANSACTION_SQL = "ROLLBACK";

export const SCHEMA_VERSION_TABLE = "schema_version";

const CREATE_SCHEMA_VERSION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const SELECT_APPLIED_VERSIONS_SQL = `SELECT version FROM ${SCHEMA_VERSION_TABLE} ORDER BY version`;
const RECORD_VERSION_SQL = `INSERT INTO ${SCHEMA_VERSION_TABLE} (version) VALUES (?)`;

/** Runs `work` inside a transaction, rolling back when it throws. */
export function runInTransaction(database, work) {
  database.exec(BEGIN_TRANSACTION_SQL);
  try {
    const result = work();
    database.exec(COMMIT_TRANSACTION_SQL);
    return result;
  } catch (error) {
    database.exec(ROLLBACK_TRANSACTION_SQL);
    throw error;
  }
}

function assertAscendingVersions(migrations) {
  migrations.forEach((migration, index) => {
    const previous = migrations[index - 1];
    if (previous && migration.version <= previous.version) {
      throw new Error(`migration versions must be strictly ascending: ${migration.version}`);
    }
  });
}

function listAppliedVersions(database) {
  return database.prepare(SELECT_APPLIED_VERSIONS_SQL).all().map((row) => row.version);
}

function applyMigration(database, migration) {
  runInTransaction(database, () => {
    migration.apply(database);
    database.prepare(RECORD_VERSION_SQL).run(migration.version);
  });
}

/** Applies every migration whose version is not yet recorded, in ascending order. */
export function runMigrations(database, migrations) {
  assertAscendingVersions(migrations);
  database.exec(CREATE_SCHEMA_VERSION_TABLE_SQL);
  const appliedVersions = new Set(listAppliedVersions(database));
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    applyMigration(database, migration);
  }
}
