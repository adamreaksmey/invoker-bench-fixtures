import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS_TABLE = "schema_migrations";

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "create_auth_tables",
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
    name: "create_ledger_tables",
    sql: `
      CREATE TABLE accounts (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (user_id, id)
      );
      CREATE TABLE transactions (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
        description TEXT,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY (user_id, account_id) REFERENCES accounts(user_id, id) ON DELETE CASCADE
      );
      CREATE INDEX transactions_account_idx ON transactions(user_id, account_id);
    `,
  },
];

/** Impure: applies every pending migration, each in its own transaction, and records it. */
export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => number = Date.now,
): number[] {
  ensureMigrationsTable(db);
  const applied = readAppliedVersions(db);
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  for (const migration of pending) applyMigration(db, migration, now());
  return pending.map((migration) => migration.version);
}

export function currentSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare(`SELECT MAX(version) AS version FROM ${MIGRATIONS_TABLE}`).get() as {
    version: number | null;
  };
  return Number(row.version ?? 0);
}

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
}

function readAppliedVersions(db: DatabaseSync): Set<number> {
  const rows = db.prepare(`SELECT version FROM ${MIGRATIONS_TABLE}`).all() as { version: number }[];
  return new Set(rows.map((row) => Number(row.version)));
}

function applyMigration(db: DatabaseSync, migration: Migration, appliedAt: number): void {
  db.exec("BEGIN");
  try {
    db.exec(migration.sql);
    db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`)
      .run(migration.version, migration.name, appliedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
