import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    const database = new DatabaseSync(databasePath);
    try {
      assert.deepEqual(
        database.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version),
        [1, 2],
      );
    } finally {
      database.close();
    }
  } finally {
    await secondServer.close();
    secondApp.locals.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("records redirect clicks and reports UTC click statistics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "link-shortener-analytics-"));
  const databasePath = join(directory, "links.sqlite");
  let currentTime = Date.parse("2026-01-02T03:04:05.000Z");
  const app = createApp({ databasePath, now: () => currentTime });
  const server = await startServer(app);
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com/analytics", code: "stats" });

    const empty = await fetch(`${server.baseUrl}/links/stats/stats`);
    assert.deepEqual(await empty.json(), {
      code: "stats",
      url: "https://example.com/analytics",
      totalClicks: 0,
      lastClickedAt: null,
      clicksByDay: {},
    });

    const first = await fetch(`${server.baseUrl}/stats`, {
      redirect: "manual",
      headers: { referer: "https://example.com/source" },
    });
    assert.equal(first.status, 302);

    currentTime = Date.parse("2026-01-02T23:59:59.999Z");
    const second = await fetch(`${server.baseUrl}/stats`, { redirect: "manual" });
    assert.equal(second.status, 302);

    currentTime = Date.parse("2026-01-03T00:00:00.000Z");
    const third = await fetch(`${server.baseUrl}/stats`, { redirect: "manual" });
    assert.equal(third.status, 302);

    const stats = await fetch(`${server.baseUrl}/links/stats/stats`);
    assert.equal(stats.status, 200);
    assert.deepEqual(await stats.json(), {
      code: "stats",
      url: "https://example.com/analytics",
      totalClicks: 3,
      lastClickedAt: "2026-01-03T00:00:00.000Z",
      clicksByDay: { "2026-01-02": 2, "2026-01-03": 1 },
    });
    assert.equal((await fetch(`${server.baseUrl}/links/stats/stats`)).status, 200);
    assert.equal((await (await fetch(`${server.baseUrl}/links/stats/stats`)).json()).totalClicks, 3);
    const database = new DatabaseSync(databasePath);
    try {
      assert.deepEqual(
        database.prepare("SELECT referer FROM clicks ORDER BY id").all().map((row) => row.referer),
        ["https://example.com/source", null, null],
      );
    } finally {
      database.close();
    }
  } finally {
    await server.close();
    app.locals.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("click analytics persist across app restarts and unknown stats return 404", async () => {
  const directory = await mkdtemp(join(tmpdir(), "link-shortener-analytics-restart-"));
  const databasePath = join(directory, "links.sqlite");
  const firstApp = createApp({ databasePath, now: () => Date.parse("2026-02-03T12:00:00.000Z") });
  const firstServer = await startServer(firstApp);
  try {
    await postJson(firstServer.baseUrl, "/links", { url: "https://example.com/restart", code: "restart" });
    const redirect = await fetch(`${firstServer.baseUrl}/restart`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
  } finally {
    await firstServer.close();
    firstApp.locals.close();
  }

  const secondApp = createApp({ databasePath });
  const secondServer = await startServer(secondApp);
  try {
    const stats = await fetch(`${secondServer.baseUrl}/links/restart/stats`);
    assert.equal(stats.status, 200);
    assert.equal((await stats.json()).totalClicks, 1);
    assert.equal((await fetch(`${secondServer.baseUrl}/links/missing/stats`)).status, 404);
  } finally {
    await secondServer.close();
    secondApp.locals.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("limits link creation per IP and leaves redirects and stats unlimited", async () => {
  const directory = await mkdtemp(join(tmpdir(), "link-shortener-rate-limit-"));
  const databasePath = join(directory, "links.sqlite");
  let currentTime = 10_000;
  const app = createApp({ databasePath, rateLimitMax: 2, rateLimitWindowMs: 10_000, now: () => currentTime });
  const server = await startServer(app);
  try {
    const first = await postJson(server.baseUrl, "/links", { url: "https://example.com/first", code: "first" });
    assert.equal(first.status, 201);
    const second = await postJson(server.baseUrl, "/links", { url: "https://example.com/second", code: "second" });
    assert.equal(second.status, 201);

    const limited = await postJson(server.baseUrl, "/links", { url: "https://example.com/third", code: "third" });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "10");
    assert.equal(typeof (await limited.json()).error, "string");
    assert.equal((await fetch(`${server.baseUrl}/links/third`)).status, 404);

    assert.equal((await fetch(`${server.baseUrl}/first`, { redirect: "manual" })).status, 302);
    assert.equal((await fetch(`${server.baseUrl}/links/first/stats`)).status, 200);

    currentTime += 10_000;
    const afterWindow = await postJson(server.baseUrl, "/links", { url: "https://example.com/third", code: "third" });
    assert.equal(afterWindow.status, 201);
  } finally {
    await server.close();
    app.locals.close();
    await rm(directory, { recursive: true, force: true });
  }
});
