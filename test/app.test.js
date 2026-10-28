import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { postJson, startServer } from "./helpers.js";

function tempDatabasePath() {
  return path.join(tmpdir(), `shortener-${randomUUID()}.sqlite`);
}

async function createServer(options = {}) {
  const app = createApp({ databasePath: tempDatabasePath(), ...options });
  return startServer(app);
}

test("creates a link and redirects to it", async () => {
  const server = await createServer();
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
  const server = await createServer();
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

test("links persist across app restarts", async () => {
  const databasePath = tempDatabasePath();
  const app1 = createApp({ databasePath });
  const server1 = await startServer(app1);
  try {
    const response = await postJson(server1.baseUrl, "/links", {
      url: "https://persistent.example.com",
      code: "persist",
    });
    assert.equal(response.status, 201);
  } finally {
    await server1.close();
  }

  const app2 = createApp({ databasePath });
  const server2 = await startServer(app2);
  try {
    const found = await fetch(`${server2.baseUrl}/links/persist`);
    assert.equal(found.status, 200);
    const body = await found.json();
    assert.equal(body.url, "https://persistent.example.com");
  } finally {
    await server2.close();
  }
});

test("rejects invalid urls", async () => {
  const server = await createServer();
  try {
    const invalidUrls = ["not-a-url", "ftp://example.com", "", "/relative/path"];
    for (const url of invalidUrls) {
      const response = await postJson(server.baseUrl, "/links", { url });
      assert.equal(response.status, 400, `url ${url} should be rejected`);
      const body = await response.json();
      assert.equal(typeof body.error, "string");
    }
    const missing = await postJson(server.baseUrl, "/links", {});
    assert.equal(missing.status, 400);
  } finally {
    await server.close();
  }
});

test("rejects invalid custom codes", async () => {
  const server = await createServer();
  try {
    const invalidCodes = ["ab", "abc!", "a".repeat(33), "abc def", "UPPERCASE!"];
    for (const code of invalidCodes) {
      const response = await postJson(server.baseUrl, "/links", { url: "https://example.com", code });
      assert.equal(response.status, 400, `code ${code} should be rejected`);
    }
  } finally {
    await server.close();
  }
});

test("returns 409 for duplicate custom code", async () => {
  const server = await createServer();
  try {
    const first = await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "duplicate" });
    assert.equal(first.status, 201);
    const second = await postJson(server.baseUrl, "/links", { url: "https://other.example.com", code: "duplicate" });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, "code already exists");
  } finally {
    await server.close();
  }
});

test("records clicks and returns stats", async () => {
  const nowMs = Date.UTC(2026, 0, 2, 3, 4, 5);
  const server = await createServer({ now: () => nowMs });
  try {
    await postJson(server.baseUrl, "/links", { url: "https://stats.example.com", code: "stats" });

    for (let index = 0; index < 3; index += 1) {
      await fetch(`${server.baseUrl}/stats`, {
        headers: { referer: "https://referrer.example.com" },
        redirect: "manual",
      });
    }

    const statsResponse = await fetch(`${server.baseUrl}/links/stats/stats`);
    assert.equal(statsResponse.status, 200);
    const stats = await statsResponse.json();
    assert.equal(stats.code, "stats");
    assert.equal(stats.url, "https://stats.example.com");
    assert.equal(stats.totalClicks, 3);
    assert.equal(stats.lastClickedAt, "2026-01-02T03:04:05.000Z");
    assert.deepEqual(stats.clicksByDay, { "2026-01-02": 3 });
  } finally {
    await server.close();
  }
});

test("stats returns empty analytics for links with no clicks", async () => {
  const server = await createServer();
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "empty" });
    const response = await fetch(`${server.baseUrl}/links/empty/stats`);
    assert.equal(response.status, 200);
    const stats = await response.json();
    assert.equal(stats.totalClicks, 0);
    assert.equal(stats.lastClickedAt, null);
    assert.deepEqual(stats.clicksByDay, {});
  } finally {
    await server.close();
  }
});

test("stats requests do not count as clicks", async () => {
  const server = await createServer();
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "noclicks" });
    await fetch(`${server.baseUrl}/links/noclicks/stats`);
    const response = await fetch(`${server.baseUrl}/links/noclicks/stats`);
    const stats = await response.json();
    assert.equal(stats.totalClicks, 0);
  } finally {
    await server.close();
  }
});

test("returns 404 for stats of unknown code", async () => {
  const server = await createServer();
  try {
    const response = await fetch(`${server.baseUrl}/links/unknown/stats`);
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test("clicks persist across app restarts", async () => {
  const databasePath = tempDatabasePath();
  const app1 = createApp({ databasePath });
  const server1 = await startServer(app1);
  try {
    await postJson(server1.baseUrl, "/links", { url: "https://clickpersist.example.com", code: "cppersist" });
    await fetch(`${server1.baseUrl}/cppersist`, { redirect: "manual" });
  } finally {
    await server1.close();
  }

  const app2 = createApp({ databasePath });
  const server2 = await startServer(app2);
  try {
    const response = await fetch(`${server2.baseUrl}/links/cppersist/stats`);
    const stats = await response.json();
    assert.equal(stats.totalClicks, 1);
  } finally {
    await server2.close();
  }
});

test("rate limits link creation per ip", async () => {
  let nowMs = 0;
  const windowMs = 60000;
  const server = await createServer({ rateLimitMax: 2, rateLimitWindowMs: windowMs, now: () => nowMs });
  try {
    const first = await postJson(server.baseUrl, "/links", { url: "https://example.com/1" });
    assert.equal(first.status, 201);

    const second = await postJson(server.baseUrl, "/links", { url: "https://example.com/2" });
    assert.equal(second.status, 201);

    const third = await postJson(server.baseUrl, "/links", { url: "https://example.com/3" });
    assert.equal(third.status, 429);
    const retryAfter = third.headers.get("retry-after");
    assert.ok(retryAfter);
    assert.equal(Number(retryAfter), Math.ceil(windowMs / 1000));
    assert.equal((await third.json()).error, "rate limit exceeded");

    nowMs += windowMs;
    const afterWindow = await postJson(server.baseUrl, "/links", { url: "https://example.com/4" });
    assert.equal(afterWindow.status, 201);
  } finally {
    await server.close();
  }
});

test("redirects and stats are not rate limited", async () => {
  const server = await createServer({ rateLimitMax: 0, rateLimitWindowMs: 60000 });
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com", code: "nolimit" });
    const redirect = await fetch(`${server.baseUrl}/nolimit`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    const stats = await fetch(`${server.baseUrl}/links/nolimit/stats`);
    assert.equal(stats.status, 200);
  } finally {
    await server.close();
  }
});

test("rejected link creation does not store link", async () => {
  let nowMs = 0;
  const windowMs = 60000;
  const server = await createServer({ rateLimitMax: 1, rateLimitWindowMs: windowMs, now: () => nowMs });
  try {
    await postJson(server.baseUrl, "/links", { url: "https://example.com/1", code: "first" });
    const rejected = await postJson(server.baseUrl, "/links", { url: "https://example.com/2", code: "second" });
    assert.equal(rejected.status, 429);

    nowMs += windowMs;
    const later = await postJson(server.baseUrl, "/links", { url: "https://example.com/2", code: "second" });
    assert.equal(later.status, 201);
  } finally {
    await server.close();
  }
});
