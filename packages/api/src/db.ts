import { DatabaseSync } from "node:sqlite";

type Migration = { version: number; sql: string };

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
    `,
  },
  {
    version: 2,
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
        amount_cents INTEGER NOT NULL,
        description TEXT,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY (user_id, account_id) REFERENCES accounts(user_id, id) ON DELETE CASCADE
      );
      CREATE INDEX accounts_user_id_idx ON accounts(user_id);
      CREATE INDEX transactions_user_account_idx ON transactions(user_id, account_id);
    `,
  },
];

/** Run ordered, durable schema migrations for both new and existing databases. */
export function runMigrations(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL)");

  // Databases created before migrations had auth tables but no migration record.
  const hasUsers = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get());
  const hasVersionOne = Boolean(db.prepare("SELECT 1 FROM schema_migrations WHERE version = 1").get());
  if (hasUsers && !hasVersionOne) db.prepare("INSERT INTO schema_migrations (version) VALUES (1)").run();

  for (const migration of migrations) {
    if (db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(migration.version);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** Open the local SQLite database and ensure the persistence schema exists. */
export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}
