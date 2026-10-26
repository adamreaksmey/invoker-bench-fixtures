import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { postJson, startServer, tempDatabasePath } from "./helpers.js";

function createTestApp(overrides = {}) {
  return createApp({
    databasePath: tempDatabasePath(),
    rateLimitMax: 100,
    ...overrides,
  });
}

test("creates a link and redirects to it", async () => {
  const app = createTestApp();
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
  }
});

test("returns link metadata and 404 for unknown codes", async () => {
  const app = createTestApp();
  const server = await startServer(app);
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

test("persists links across app instances on the same database file", async () => {
  const databasePath = tempDatabasePath();
  const firstApp = createApp({ databasePath, rateLimitMax: 100 });
  const firstServer = await startServer(firstApp);
  let code;
  try {
    const created = await postJson(firstServer.baseUrl, "/links", {
      url: "https://example.com/persist",
      code: "keepme",
    });
    assert.equal(created.status, 201);
    code = (await created.json()).code;
  } finally {
    await firstServer.close();
  }

  const secondApp = createApp({ databasePath, rateLimitMax: 100 });
  const secondServer = await startServer(secondApp);
  try {
    const found = await fetch(`${secondServer.baseUrl}/links/${code}`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).url, "https://example.com/persist");
  } finally {
    await secondServer.close();
  }
});

test("rejects non-http URLs and invalid custom codes", async () => {
  const app = createTestApp();
  const server = await startServer(app);
  try {
    const badUrl = await postJson(server.baseUrl, "/links", { url: "ftp://example.com" });
    assert.equal(badUrl.status, 400);
    assert.equal(typeof (await badUrl.json()).error, "string");

    const relativeUrl = await postJson(server.baseUrl, "/links", { url: "/relative" });
    assert.equal(relativeUrl.status, 400);

    const badCode = await postJson(server.baseUrl, "/links", {
      url: "https://example.com",
      code: "ab",
    });
    assert.equal(badCode.status, 400);
    assert.equal(typeof (await badCode.json()).error, "string");
  } finally {
    await server.close();
  }
});

test("returns 409 when a custom code already exists", async () => {
  const app = createTestApp();
  const server = await startServer(app);
  try {
    const first = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/one",
      code: "taken",
    });
    assert.equal(first.status, 201);

    const conflict = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/two",
      code: "taken",
    });
    assert.equal(conflict.status, 409);
    assert.equal(typeof (await conflict.json()).error, "string");
  } finally {
    await server.close();
  }
});

test("records click analytics and exposes stats without counting stats views", async () => {
  let currentTime = Date.parse("2026-01-02T03:04:05.000Z");
  const app = createTestApp({ now: () => currentTime });
  const server = await startServer(app);
  try {
    await postJson(server.baseUrl, "/links", {
      url: "https://example.com/tracked",
      code: "track",
    });

    const redirect = await fetch(`${server.baseUrl}/track`, {
      redirect: "manual",
      headers: { referer: "https://news.example/article" },
    });
    assert.equal(redirect.status, 302);

    currentTime = Date.parse("2026-01-03T10:00:00.000Z");
    await fetch(`${server.baseUrl}/track`, { redirect: "manual" });

    const statsResponse = await fetch(`${server.baseUrl}/links/track/stats`);
    assert.equal(statsResponse.status, 200);
    const stats = await statsResponse.json();
    assert.deepEqual(stats, {
      code: "track",
      url: "https://example.com/tracked",
      totalClicks: 2,
      lastClickedAt: "2026-01-03T10:00:00.000Z",
      clicksByDay: { "2026-01-02": 1, "2026-01-03": 1 },
    });

    const again = await fetch(`${server.baseUrl}/links/track/stats`);
    assert.equal((await again.json()).totalClicks, 2);

    assert.equal((await fetch(`${server.baseUrl}/links/missing/stats`)).status, 404);
  } finally {
    await server.close();
  }
});

test("persists clicks across restarts", async () => {
  const databasePath = tempDatabasePath();
  const firstApp = createApp({
    databasePath,
    rateLimitMax: 100,
    now: () => Date.parse("2026-01-02T03:04:05.000Z"),
  });
  const firstServer = await startServer(firstApp);
  try {
    await postJson(firstServer.baseUrl, "/links", {
      url: "https://example.com/clicks",
      code: "clk",
    });
    await fetch(`${firstServer.baseUrl}/clk`, { redirect: "manual" });
  } finally {
    await firstServer.close();
  }

  const secondApp = createApp({ databasePath, rateLimitMax: 100 });
  const secondServer = await startServer(secondApp);
  try {
    const stats = await (await fetch(`${secondServer.baseUrl}/links/clk/stats`)).json();
    assert.equal(stats.totalClicks, 1);
    assert.equal(stats.lastClickedAt, "2026-01-02T03:04:05.000Z");
  } finally {
    await secondServer.close();
  }
});

test("rate limits link creation per client IP with Retry-After", async () => {
  const windowMs = 60_000;
  let currentTime = 1_000_000;
  const app = createTestApp({
    rateLimitMax: 2,
    rateLimitWindowMs: windowMs,
    now: () => currentTime,
  });
  const server = await startServer(app);
  try {
    assert.equal(
      (await postJson(server.baseUrl, "/links", { url: "https://example.com/a", code: "aa1" })).status,
      201,
    );
    assert.equal(
      (await postJson(server.baseUrl, "/links", { url: "https://example.com/b", code: "aa2" })).status,
      201,
    );

    const limited = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/c",
      code: "aa3",
    });
    assert.equal(limited.status, 429);
    assert.equal(typeof (await limited.json()).error, "string");
    const retryAfter = Number(limited.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1);

    assert.equal((await fetch(`${server.baseUrl}/links/aa3`)).status, 404);

    const redirect = await fetch(`${server.baseUrl}/aa1`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal((await fetch(`${server.baseUrl}/links/aa1/stats`)).status, 200);

    currentTime += windowMs;
    const afterWindow = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/c",
      code: "aa3",
    });
    assert.equal(afterWindow.status, 201);
  } finally {
    await server.close();
  }
});
