import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { postJson, startServer } from "./helpers.js";

test("creates a link and redirects to it", async () => {
  const app = createApp();
  const server = await startServer(app);
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
    app.locals.close();
  }
});

test("rejects URLs that are not absolute HTTP or HTTPS URLs", async () => {
  const app = createApp();
  const server = await startServer(app);
  try {
    for (const url of ["", "example.com", "/relative", "ftp://example.com/file", "javascript:alert(1)"]) {
      const response = await postJson(server.baseUrl, "/links", { url });
      assert.equal(response.status, 400, url);
      assert.equal(typeof (await response.json()).error, "string");
    }
  } finally {
    await server.close();
    app.locals.close();
  }
});

test("validates custom codes and returns conflict for duplicates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "link-shortener-validation-"));
  const app = createApp({ databasePath: join(directory, "links.sqlite") });
  const server = await startServer(app);
  try {
    for (const code of ["ab", "a".repeat(33), "has space", "bad!", 123]) {
      const response = await postJson(server.baseUrl, "/links", { url: "https://example.com", code });
      assert.equal(response.status, 400, String(code));
      assert.equal(typeof (await response.json()).error, "string");
    }

    const first = await postJson(server.baseUrl, "/links", { url: "https://example.com/first", code: "my_code-1" });
    assert.equal(first.status, 201);
    const duplicate = await postJson(server.baseUrl, "/links", { url: "https://example.com/second", code: "my_code-1" });
    assert.equal(duplicate.status, 409);
    assert.equal(typeof (await duplicate.json()).error, "string");
    const existing = await fetch(`${server.baseUrl}/links/my_code-1`);
    assert.equal((await existing.json()).url, "https://example.com/first");
  } finally {
    await server.close();
    app.locals.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns link metadata and 404 for unknown codes", async () => {
  const app = createApp();
  const server = await startServer(app);
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "home" });
    const found = await fetch(`${server.baseUrl}/links/home`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).url, "https://example.com");
    assert.equal((await fetch(`${server.baseUrl}/links/missing`)).status, 404);
  } finally {
    await server.close();
    app.locals.close();
  }
});

test("links persist when a new app instance opens the same database file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "link-shortener-"));
  const databasePath = join(directory, "links.sqlite");
  const firstApp = createApp({ databasePath });
  const firstServer = await startServer(firstApp);
  let code;
  try {
    const created = await postJson(firstServer.baseUrl, "/links", {
      url: "https://example.com/persisted",
      code: "persisted",
    });
    assert.equal(created.status, 201);
    ({ code } = await created.json());
  } finally {
    await firstServer.close();
    firstApp.locals.close();
  }

  const secondApp = createApp({ databasePath });
  const secondServer = await startServer(secondApp);
  try {
    const found = await fetch(`${secondServer.baseUrl}/links/${code}`);
    assert.equal(found.status, 200);
    const link = await found.json();
    assert.equal(link.code, "persisted");
    assert.equal(link.url, "https://example.com/persisted");
    assert.ok(Number.isFinite(Date.parse(link.createdAt)));
  } finally {
    await secondServer.close();
    secondApp.locals.close();
    await rm(directory, { recursive: true, force: true });
  }
});
