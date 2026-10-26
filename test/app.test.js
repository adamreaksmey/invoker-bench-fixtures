import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { postJson, startServer } from "./helpers.js";

async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "shortener-test-"));
  return { path: join(directory, "links.sqlite"), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("creates a link and redirects to it", async () => {
  const server = await startServer(createApp());
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
  const server = await startServer(createApp());
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

test("persists links across app instances", async () => {
  const database = await temporaryDatabase();
  const firstApp = createApp({ databasePath: database.path });
  const firstServer = await startServer(firstApp);
  try {
    await postJson(firstServer.baseUrl, "/links", { url: "https://example.com/persisted", code: "saved" });
  } finally {
    await firstServer.close();
    firstApp.locals.close();
  }
  const secondApp = createApp({ databasePath: database.path });
  const secondServer = await startServer(secondApp);
  try {
    const response = await fetch(`${secondServer.baseUrl}/links/saved`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).url, "https://example.com/persisted");
  } finally {
    await secondServer.close();
    secondApp.locals.close();
    await database.cleanup();
  }
});

test("validates URLs and custom codes and rejects duplicates", async () => {
  const database = await temporaryDatabase();
  const app = createApp({ databasePath: database.path });
  const server = await startServer(app);
  try {
    for (const url of ["example.com", "ftp://example.com", "javascript:alert(1)"]) {
      assert.equal((await postJson(server.baseUrl, "/links", { url })).status, 400);
    }
    assert.equal((await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "no spaces" })).status, 400);
    assert.equal((await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "good" })).status, 201);
    assert.equal((await postJson(server.baseUrl, "/links", { url: "https://example.org", code: "good" })).status, 409);
  } finally {
    await server.close();
    app.locals.close();
    await database.cleanup();
  }
});

test("records redirect clicks and reports UTC daily stats", async () => {
  const database = await temporaryDatabase();
  let currentTime = Date.parse("2026-01-02T23:59:59.000Z");
  const app = createApp({ databasePath: database.path, now: () => currentTime });
  const server = await startServer(app);
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com/analytics", code: "stats" });
    let response = await fetch(`${server.baseUrl}/links/stats/stats`);
    assert.deepEqual(await response.json(), {
      code: "stats", url: "https://example.com/analytics", totalClicks: 0, lastClickedAt: null, clicksByDay: {},
    });
    response = await fetch(`${server.baseUrl}/stats`, { redirect: "manual", headers: { referer: "https://referrer.example" } });
    assert.equal(response.status, 302);
    currentTime = Date.parse("2026-01-03T00:00:01.000Z");
    response = await fetch(`${server.baseUrl}/stats`, { redirect: "manual" });
    assert.equal(response.status, 302);
    response = await fetch(`${server.baseUrl}/links/stats/stats`);
    assert.deepEqual(await response.json(), {
      code: "stats", url: "https://example.com/analytics", totalClicks: 2,
      lastClickedAt: "2026-01-03T00:00:01.000Z", clicksByDay: { "2026-01-02": 1, "2026-01-03": 1 },
    });
  } finally {
    await server.close();
    app.locals.close();
    await database.cleanup();
  }
});

test("limits link creation per IP for a fixed window", async () => {
  const database = await temporaryDatabase();
  let currentTime = 10_000;
  const app = createApp({ databasePath: database.path, rateLimitMax: 2, rateLimitWindowMs: 10_000, now: () => currentTime });
  const server = await startServer(app);
  try {
    assert.equal((await postJson(server.baseUrl, "/links", { url: "https://example.com/1", code: "one" })).status, 201);
    assert.equal((await postJson(server.baseUrl, "/links", { url: "https://example.com/2", code: "two" })).status, 201);
    const limited = await postJson(server.baseUrl, "/links", { url: "https://example.com/3", code: "three" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal((await fetch(`${server.baseUrl}/one`, { redirect: "manual" })).status, 302);
    assert.equal((await fetch(`${server.baseUrl}/links/one/stats`)).status, 200);
    currentTime += 10_000;
    assert.equal((await postJson(server.baseUrl, "/links", { url: "https://example.com/3", code: "three" })).status, 201);
  } finally {
    await server.close();
    app.locals.close();
    await database.cleanup();
  }
});
