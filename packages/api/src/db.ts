import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = [
  { version: 1, file: "001_accounts_and_transactions.sql" },
] as const;

/** Open the local SQLite database and ensure the persistence schema exists. */
export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  // Keep the auth schema bootstrap idempotent so databases created before migrations
  // continue to work. Ledger migrations depend on users, so bootstrap auth first.
  db.exec(`
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
  `);
  runMigrations(db);
  return db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const applied = db.prepare("SELECT version FROM schema_migrations");
  const insert = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  for (const migration of MIGRATIONS) {
    const existing = applied.all() as Array<{ version: number }>;
    if (existing.some(({ version }) => version === migration.version)) continue;

    const sql = readFileSync(join(__dirname, "migrations", migration.file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      insert.run(migration.version, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
