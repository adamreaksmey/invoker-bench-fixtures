import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { createTemporaryApp, createTemporaryDatabasePath, postJson, startServer } from "./helpers.js";

test("creates a link and redirects to it", async () => {
  const temporaryApp = createTemporaryApp();
  const server = await startServer(temporaryApp.app);
  try {
    const created = await postJson(server.baseUrl, "/links", { url: "https://example.com/docs" });
    assert.equal(created.status, 201);
    const { code, shortUrl } = await created.json();
    assert.equal(shortUrl, `/${code}`);

    const redirect = await fetch(`${server.baseUrl}/${code}`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "https://example.com/docs");
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("returns link metadata and 404 for unknown codes", async () => {
  const temporaryApp = createTemporaryApp();
  const server = await startServer(temporaryApp.app);
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "home" });
    const found = await fetch(`${server.baseUrl}/links/home`);
    assert.equal(found.status, 200);
    const metadata = await found.json();
    assert.equal(metadata.url, "https://example.com");
    assert.equal(metadata.code, "home");
    assert.ok(!Number.isNaN(Date.parse(metadata.createdAt)));
    assert.equal((await fetch(`${server.baseUrl}/links/missing`)).status, 404);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("a link created by one app instance is readable by a new instance on the same database file", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  const firstApp = createApp({ databasePath: temporaryDatabase.databasePath });
  const firstServer = await startServer(firstApp);
  let createdCode;
  try {
    const created = await postJson(firstServer.baseUrl, "/links", {
      url: "https://example.com/persisted",
      code: "persisted",
    });
    assert.equal(created.status, 201);
    createdCode = (await created.json()).code;
  } finally {
    await firstServer.close();
  }

  const reopenedApp = createApp({ databasePath: temporaryDatabase.databasePath });
  const reopenedServer = await startServer(reopenedApp);
  try {
    const metadata = await fetch(`${reopenedServer.baseUrl}/links/${createdCode}`);
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).url, "https://example.com/persisted");
  } finally {
    await reopenedServer.close();
    temporaryDatabase.remove();
  }
});

test("records applied migration versions once in schema_migrations", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  try {
    const firstApp = createApp({ databasePath: temporaryDatabase.databasePath });
    assert.deepEqual(readAppliedMigrationVersions(temporaryDatabase.databasePath), [1]);
    firstApp.locals.close();

    const reopenedApp = createApp({ databasePath: temporaryDatabase.databasePath });
    assert.deepEqual(readAppliedMigrationVersions(temporaryDatabase.databasePath), [1]);
    reopenedApp.locals.close();
  } finally {
    temporaryDatabase.remove();
  }
});

function readAppliedMigrationVersions(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => row.version);
  } finally {
    database.close();
  }
}

test("uses the injected now option for createdAt", async () => {
  const FIXED_NOW_MS = 1_767_323_045_000;
  const temporaryApp = createTemporaryApp({ now: () => FIXED_NOW_MS });
  const server = await startServer(temporaryApp.app);
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "clock" });
    const metadata = await (await fetch(`${server.baseUrl}/links/clock`)).json();
    assert.equal(metadata.createdAt, new Date(FIXED_NOW_MS).toISOString());
  } finally {
    await server.close();
    temporaryApp.close();
  }
});
