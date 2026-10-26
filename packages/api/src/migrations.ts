import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
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
        FOREIGN KEY (user_id, account_id)
          REFERENCES accounts(user_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS transactions_user_account_idx
        ON transactions(user_id, account_id);
    `,
  },
];

/** Apply each database migration once, retaining a single current schema version. */
export function runMigrations(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  let currentVersion = row ? Number(row.version) : 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("UPDATE schema_version SET version = ?").run(migration.version);
      db.exec("COMMIT");
      currentVersion = migration.version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export const latestSchemaVersion = migrations[migrations.length - 1].version;
