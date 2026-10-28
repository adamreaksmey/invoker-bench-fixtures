import { DatabaseSync } from "node:sqlite";

const CREATE_SCHEMA_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`;

const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS links (
        code TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        clicked_at TEXT NOT NULL,
        referer TEXT
      );
    `,
  },
];

export class ShortenerDatabase {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath);
    this.runMigrations();
  }

  close() {
    this.database.close();
  }

  runMigrations() {
    this.database.exec(CREATE_SCHEMA_MIGRATIONS_TABLE);
    const appliedVersions = this.loadAppliedVersions();
    for (const migration of MIGRATIONS) {
      if (!appliedVersions.has(migration.version)) {
        this.applyMigration(migration);
      }
    }
  }

  loadAppliedVersions() {
    const rows = this.database.prepare("SELECT version FROM schema_migrations").all();
    return new Set(rows.map((row) => row.version));
  }

  applyMigration(migration) {
    this.database.exec(migration.up);
    this.database
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(migration.version, new Date().toISOString());
  }

  createLink(code, url, createdAt) {
    try {
      this.database
        .prepare("INSERT INTO links (code, url, created_at) VALUES (?, ?, ?)")
        .run(code, url, createdAt);
      return { success: true };
    } catch (error) {
      if (isDuplicateCodeError(error)) return { success: false, reason: "duplicate_code" };
      throw error;
    }
  }

  getLinkByCode(code) {
    return this.database.prepare("SELECT code, url, created_at FROM links WHERE code = ?").get(code) ?? null;
  }

  recordClick(code, clickedAt, referer) {
    this.database
      .prepare("INSERT INTO clicks (code, clicked_at, referer) VALUES (?, ?, ?)")
      .run(code, clickedAt, referer);
  }

  getClickStats(code) {
    const totalRow = this.database.prepare("SELECT COUNT(*) AS total FROM clicks WHERE code = ?").get(code);
    const lastRow = this.database
      .prepare("SELECT MAX(clicked_at) AS last_clicked_at FROM clicks WHERE code = ?")
      .get(code);
    const dayRows = this.database
      .prepare("SELECT SUBSTR(clicked_at, 1, 10) AS day, COUNT(*) AS count FROM clicks WHERE code = ? GROUP BY day")
      .all(code);

    const clicksByDay = {};
    for (const row of dayRows) clicksByDay[row.day] = row.count;

    return {
      totalClicks: totalRow.total,
      lastClickedAt: lastRow.last_clicked_at ?? null,
      clicksByDay,
    };
  }
}

const SQLITE_CONSTRAINT_PRIMARYKEY_ERRCODE = 1555;

function isDuplicateCodeError(error) {
  return error instanceof Error && error.errcode === SQLITE_CONSTRAINT_PRIMARYKEY_ERRCODE;
}
