import { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE IF NOT EXISTS transactions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        description TEXT,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY (user_id, account_id) REFERENCES accounts(user_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);
      CREATE INDEX IF NOT EXISTS transactions_user_account_idx ON transactions(user_id, account_id);
    `,
  },
];

/** Open the local SQLite database and apply pending schema migrations. */
export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

/** Apply versioned migrations; safe for new DBs and existing auth-only DBs. */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  bootstrapLegacyAuthVersion(db);

  const current = currentSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function currentSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_version").get() as
    | { version: number | null }
    | undefined;
  return Number(row?.version ?? 0);
}

/**
 * Databases created before the migration runner already have auth tables.
 * Record version 1 so auth stays intact and only newer migrations run.
 */
function bootstrapLegacyAuthVersion(db: DatabaseSync): void {
  if (currentSchemaVersion(db) > 0) return;
  const users = db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).get() as { ok: number } | undefined;
  if (!users) return;
  db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(1, Date.now());
}
