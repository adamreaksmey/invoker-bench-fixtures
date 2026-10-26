import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { createTestApp, postJson, startServer } from "./helpers.js";

const TEMP_DIR_PREFIX = "shortener-persist-";
const SHARED_DATABASE_FILENAME = "shared.sqlite";
const PERSISTED_CODE = "persist";
const PERSISTED_URL = "https://example.com/persisted";

test("creates a link and redirects to it", async () => {
  const server = await startServer(createTestApp());
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
  }
});

test("returns link metadata and 404 for unknown codes", async () => {
  const server = await startServer(createTestApp());
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "home" });
    const found = await fetch(`${server.baseUrl}/links/home`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).url, "https://example.com");
    assert.equal((await fetch(`${server.baseUrl}/links/missing`)).status, 404);
  } finally {
    await server.close();
  }
});

test("link created by one app instance is readable by another on the same database file", async () => {
  const directory = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
  const databasePath = join(directory, SHARED_DATABASE_FILENAME);

  const writerApp = createApp({ databasePath });
  const writerServer = await startServer(writerApp);
  try {
    const created = await postJson(writerServer.baseUrl, "/links", {
      url: PERSISTED_URL,
      code: PERSISTED_CODE,
    });
    assert.equal(created.status, 201);
  } finally {
    await writerServer.close();
  }

  const readerApp = createApp({ databasePath });
  const readerServer = await startServer(readerApp);
  try {
    const found = await fetch(`${readerServer.baseUrl}/links/${PERSISTED_CODE}`);
    assert.equal(found.status, 200);
    const body = await found.json();
    assert.equal(body.code, PERSISTED_CODE);
    assert.equal(body.url, PERSISTED_URL);
    assert.equal(typeof body.createdAt, "string");
  } finally {
    await readerServer.close();
  }
});
