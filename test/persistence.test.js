import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { createTemporaryDatabasePath, postJson, startServer } from "./helpers.js";

const EXPECTED_MIGRATION_VERSIONS = [1, 2];
const FIRST_APPLIED_AT = "2026-01-01T00:00:00.000Z";
const SECOND_APPLIED_AT = "2026-01-02T00:00:00.000Z";

function openReadOnly(databasePath) {
  return new DatabaseSync(databasePath, { readOnly: true });
}

function readTableNames(databasePath) {
  const database = openReadOnly(databasePath);
  try {
    return database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
  } finally {
    database.close();
  }
}

function readSchemaMigrationRows(databasePath) {
  const database = openReadOnly(databasePath);
  try {
    return database
      .prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({ version: row.version, applied_at: row.applied_at }));
  } finally {
    database.close();
  }
}

test("migrations create the links, clicks, and schema_migrations tables", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    const app = createApp({ databasePath: temporaryDatabase.databasePath });
    app.locals.close();

    assert.deepEqual(readTableNames(temporaryDatabase.databasePath), [
      "clicks",
      "links",
      "schema_migrations",
    ]);
  } finally {
    temporaryDatabase.remove();
  }
});

test("every applied migration records exactly one schema_migrations row", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    const app = createApp({ databasePath: temporaryDatabase.databasePath });
    app.locals.close();

    const rows = readSchemaMigrationRows(temporaryDatabase.databasePath);
    assert.deepEqual(
      rows.map((row) => row.version),
      EXPECTED_MIGRATION_VERSIONS,
    );
    for (const row of rows) {
      assert.ok(!Number.isNaN(Date.parse(row.applied_at)), "applied_at must be an ISO timestamp");
    }
  } finally {
    temporaryDatabase.remove();
  }
});

test("reopening a migrated database applies no pending migrations", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    const firstApp = createApp({ databasePath: temporaryDatabase.databasePath });
    firstApp.locals.close();
    const originalRows = readSchemaMigrationRows(temporaryDatabase.databasePath);

    const reopenedApp = createApp({ databasePath: temporaryDatabase.databasePath });
    reopenedApp.locals.close();

    assert.deepEqual(readSchemaMigrationRows(temporaryDatabase.databasePath), originalRows);
  } finally {
    temporaryDatabase.remove();
  }
});

test("a migration applied by an earlier version is not applied again", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    // Simulate a database that only knows migration 1, with a distinguishable applied_at.
    const seedDatabase = new DatabaseSync(temporaryDatabase.databasePath);
    seedDatabase.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE links (code TEXT PRIMARY KEY, url TEXT NOT NULL, created_at_ms INTEGER NOT NULL) STRICT;
    `);
    seedDatabase
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(1, FIRST_APPLIED_AT);
    seedDatabase
      .prepare("INSERT INTO links (code, url, created_at_ms) VALUES (?, ?, ?)")
      .run("seeded", "https://example.com/seeded", Date.parse(FIRST_APPLIED_AT));
    seedDatabase.close();

    const app = createApp({ databasePath: temporaryDatabase.databasePath });
    app.locals.close();

    const rows = readSchemaMigrationRows(temporaryDatabase.databasePath);
    assert.deepEqual(
      rows.map((row) => row.version),
      EXPECTED_MIGRATION_VERSIONS,
    );
    assert.equal(rows[0].applied_at, FIRST_APPLIED_AT, "migration 1 must not be re-applied");
  } finally {
    temporaryDatabase.remove();
  }
});

test("a seeded link row survives a later app start", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  const seededApp = createApp({ databasePath: temporaryDatabase.databasePath });
  seededApp.locals.close();

  const seedDatabase = new DatabaseSync(temporaryDatabase.databasePath);
  seedDatabase
    .prepare("INSERT INTO links (code, url, created_at_ms) VALUES (?, ?, ?)")
    .run("legacy", "https://example.com/legacy", Date.parse(SECOND_APPLIED_AT));
  seedDatabase.close();

  const reopenedApp = createApp({ databasePath: temporaryDatabase.databasePath });
  const server = await startServer(reopenedApp);
  try {
    const metadata = await fetch(`${server.baseUrl}/links/legacy`);
    assert.equal(metadata.status, 200);
    const body = await metadata.json();
    assert.equal(body.url, "https://example.com/legacy");
    assert.equal(body.createdAt, SECOND_APPLIED_AT);
  } finally {
    await server.close();
    temporaryDatabase.remove();
  }
});

test("links created by a new instance are visible to a third instance", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    const firstApp = createApp({ databasePath: temporaryDatabase.databasePath });
    const firstServer = await startServer(firstApp);
    try {
      const created = await postJson(firstServer.baseUrl, "/links", {
        url: "https://example.com/first",
        code: "first",
      });
      assert.equal(created.status, 201);
    } finally {
      await firstServer.close();
    }

    const secondApp = createApp({ databasePath: temporaryDatabase.databasePath });
    const secondServer = await startServer(secondApp);
    try {
      const created = await postJson(secondServer.baseUrl, "/links", {
        url: "https://example.com/second",
        code: "second",
      });
      assert.equal(created.status, 201);
    } finally {
      await secondServer.close();
    }

    const thirdApp = createApp({ databasePath: temporaryDatabase.databasePath });
    const thirdServer = await startServer(thirdApp);
    try {
      for (const code of ["first", "second"]) {
        const metadata = await fetch(`${thirdServer.baseUrl}/links/${code}`);
        assert.equal(metadata.status, 200, `expected ${code} to persist`);
      }
    } finally {
      await thirdServer.close();
    }
  } finally {
    temporaryDatabase.remove();
  }
});

test("a generated code does not collide with a persisted code", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    const firstApp = createApp({ databasePath: temporaryDatabase.databasePath });
    const firstServer = await startServer(firstApp);
    let persistedCode;
    try {
      const created = await postJson(firstServer.baseUrl, "/links", { url: "https://example.com/gen" });
      assert.equal(created.status, 201);
      persistedCode = (await created.json()).code;
    } finally {
      await firstServer.close();
    }

    const reopenedApp = createApp({ databasePath: temporaryDatabase.databasePath });
    const reopenedServer = await startServer(reopenedApp);
    try {
      const conflicting = await postJson(reopenedServer.baseUrl, "/links", {
        url: "https://example.com/other",
        code: persistedCode,
      });
      assert.equal(conflicting.status, 409);
    } finally {
      await reopenedServer.close();
    }
  } finally {
    temporaryDatabase.remove();
  }
});

test("close() is idempotent", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    const app = createApp({ databasePath: temporaryDatabase.databasePath });
    app.locals.close();
    assert.doesNotThrow(() => app.locals.close());
  } finally {
    temporaryDatabase.remove();
  }
});

test("DATABASE_PATH supplies the default database location", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  const previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = temporaryDatabase.databasePath;
  const app = createApp();
  try {
    const server = await startServer(app);
    try {
      const created = await postJson(server.baseUrl, "/links", {
        url: "https://example.com/env",
        code: "envexists",
      });
      assert.equal(created.status, 201);
    } finally {
      await server.close();
    }
    assert.ok(readTableNames(temporaryDatabase.databasePath).includes("links"));
  } finally {
    app.locals.close();
    restoreEnvironmentVariable("DATABASE_PATH", previousDatabasePath);
    temporaryDatabase.remove();
  }
});

function restoreEnvironmentVariable(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previousValue;
}
