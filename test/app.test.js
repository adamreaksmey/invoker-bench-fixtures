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

test("rejects non-absolute and non-http(s) urls with 400", async () => {
  const server = await startServer(createTestApp());
  try {
    for (const url of ["example.com/path", "/relative", "ftp://example.com", "javascript:alert(1)"]) {
      const response = await postJson(server.baseUrl, "/links", { url });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(typeof body.error, "string");
      assert.ok(body.error.length > 0);
    }

    const httpsOk = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/ok",
    });
    assert.equal(httpsOk.status, 201);

    const httpOk = await postJson(server.baseUrl, "/links", {
      url: "http://example.com/ok",
    });
    assert.equal(httpOk.status, 201);
  } finally {
    await server.close();
  }
});

test("rejects invalid custom codes with 400", async () => {
  const server = await startServer(createTestApp());
  try {
    for (const code of ["ab", "a".repeat(33), "bad code", "has.dot", "slash/y"]) {
      const response = await postJson(server.baseUrl, "/links", {
        url: "https://example.com",
        code,
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(typeof body.error, "string");
      assert.ok(body.error.length > 0);
    }

    const valid = await postJson(server.baseUrl, "/links", {
      url: "https://example.com",
      code: "ok_Code-123",
    });
    assert.equal(valid.status, 201);
  } finally {
    await server.close();
  }
});

test("rejects duplicate custom codes with 409", async () => {
  const server = await startServer(createTestApp());
  try {
    const first = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/one",
      code: "taken",
    });
    assert.equal(first.status, 201);

    const duplicate = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/two",
      code: "taken",
    });
    assert.equal(duplicate.status, 409);
    const body = await duplicate.json();
    assert.equal(typeof body.error, "string");
    assert.ok(body.error.length > 0);
  } finally {
    await server.close();
  }
});
