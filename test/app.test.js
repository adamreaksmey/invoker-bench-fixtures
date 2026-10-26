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

    for (const code of ["abc", "a".repeat(32), "ok_Code-123"]) {
      const valid = await postJson(server.baseUrl, "/links", {
        url: "https://example.com",
        code,
      });
      assert.equal(valid.status, 201);
    }
  } finally {
    await server.close();
  }
});

test("rejects missing or empty url with 400", async () => {
  const server = await startServer(createTestApp());
  try {
    for (const body of [{}, { url: "" }, { url: null }]) {
      const response = await postJson(server.baseUrl, "/links", body);
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.equal(typeof payload.error, "string");
      assert.ok(payload.error.length > 0);
    }
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

const STATS_CODE = "stats1";
const STATS_URL = "https://example.com/stats";
const CLICK_EPOCH_MS = Date.UTC(2026, 0, 2, 3, 4, 5);
const CLICK_ISO = "2026-01-02T03:04:05.000Z";
const CLICK_DAY = "2026-01-02";
const REFERER_VALUE = "https://referrer.example/page";
const SECOND_CLICK_EPOCH_MS = Date.UTC(2026, 0, 3, 12, 0, 0);
const SECOND_CLICK_DAY = "2026-01-03";

test("stats for a link with no clicks returns zeros and null lastClickedAt", async () => {
  const server = await startServer(createTestApp());
  try {
    await postJson(server.baseUrl, "/links", { url: STATS_URL, code: STATS_CODE });
    const response = await fetch(`${server.baseUrl}/links/${STATS_CODE}/stats`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: STATS_CODE,
      url: STATS_URL,
      totalClicks: 0,
      lastClickedAt: null,
      clicksByDay: {},
    });
  } finally {
    await server.close();
  }
});

test("redirects record clicks with injectable now and referer; stats aggregate by UTC day", async () => {
  // First value is consumed by POST /links rate-limit window; rest are click times.
  const timestamps = [
    CLICK_EPOCH_MS,
    CLICK_EPOCH_MS,
    CLICK_EPOCH_MS,
    SECOND_CLICK_EPOCH_MS,
  ];
  let timestampIndex = 0;
  const server = await startServer(
    createTestApp({
      now: () => timestamps[timestampIndex++],
    }),
  );
  try {
    await postJson(server.baseUrl, "/links", { url: STATS_URL, code: STATS_CODE });

    const withReferer = await fetch(`${server.baseUrl}/${STATS_CODE}`, {
      redirect: "manual",
      headers: { referer: REFERER_VALUE },
    });
    assert.equal(withReferer.status, 302);

    const withoutReferer = await fetch(`${server.baseUrl}/${STATS_CODE}`, {
      redirect: "manual",
    });
    assert.equal(withoutReferer.status, 302);

    const nextDay = await fetch(`${server.baseUrl}/${STATS_CODE}`, {
      redirect: "manual",
    });
    assert.equal(nextDay.status, 302);

    const response = await fetch(`${server.baseUrl}/links/${STATS_CODE}/stats`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: STATS_CODE,
      url: STATS_URL,
      totalClicks: 3,
      lastClickedAt: new Date(SECOND_CLICK_EPOCH_MS).toISOString(),
      clicksByDay: {
        [CLICK_DAY]: 2,
        [SECOND_CLICK_DAY]: 1,
      },
    });
  } finally {
    await server.close();
  }
});

test("stats requests do not count as clicks", async () => {
  const server = await startServer(
    createTestApp({ now: () => CLICK_EPOCH_MS }),
  );
  try {
    await postJson(server.baseUrl, "/links", { url: STATS_URL, code: STATS_CODE });
    await fetch(`${server.baseUrl}/${STATS_CODE}`, { redirect: "manual" });

    const before = await fetch(`${server.baseUrl}/links/${STATS_CODE}/stats`);
    assert.equal((await before.json()).totalClicks, 1);

    await fetch(`${server.baseUrl}/links/${STATS_CODE}/stats`);
    await fetch(`${server.baseUrl}/links/${STATS_CODE}`);

    const after = await fetch(`${server.baseUrl}/links/${STATS_CODE}/stats`);
    assert.deepEqual(await after.json(), {
      code: STATS_CODE,
      url: STATS_URL,
      totalClicks: 1,
      lastClickedAt: CLICK_ISO,
      clicksByDay: { [CLICK_DAY]: 1 },
    });
  } finally {
    await server.close();
  }
});

test("stats for unknown code returns 404", async () => {
  const server = await startServer(createTestApp());
  try {
    const response = await fetch(`${server.baseUrl}/links/missing/stats`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
  } finally {
    await server.close();
  }
});

test("clicks persist across app restarts on the same database file", async () => {
  const directory = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
  const databasePath = join(directory, SHARED_DATABASE_FILENAME);

  const writerApp = createApp({
    databasePath,
    now: () => CLICK_EPOCH_MS,
  });
  const writerServer = await startServer(writerApp);
  try {
    await postJson(writerServer.baseUrl, "/links", {
      url: STATS_URL,
      code: STATS_CODE,
    });
    const redirect = await fetch(`${writerServer.baseUrl}/${STATS_CODE}`, {
      redirect: "manual",
      headers: { referer: REFERER_VALUE },
    });
    assert.equal(redirect.status, 302);
  } finally {
    await writerServer.close();
  }

  const readerApp = createApp({ databasePath });
  const readerServer = await startServer(readerApp);
  try {
    const response = await fetch(
      `${readerServer.baseUrl}/links/${STATS_CODE}/stats`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: STATS_CODE,
      url: STATS_URL,
      totalClicks: 1,
      lastClickedAt: CLICK_ISO,
      clicksByDay: { [CLICK_DAY]: 1 },
    });
  } finally {
    await readerServer.close();
  }
});

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_WINDOW_START_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
const RATE_LIMIT_WITHIN_WINDOW_MS = RATE_LIMIT_WINDOW_START_MS + 2500;
const RATE_LIMIT_NEXT_WINDOW_MS = RATE_LIMIT_WINDOW_START_MS + RATE_LIMIT_WINDOW_MS;
const RATE_LIMITED_CODE = "limited";
const EXPECTED_RETRY_AFTER_SECONDS = 8;

test("POST /links allows rateLimitMax requests then returns 429 with Retry-After", async () => {
  let currentTimeMs = RATE_LIMIT_WITHIN_WINDOW_MS;
  const server = await startServer(
    createTestApp({
      rateLimitMax: RATE_LIMIT_MAX,
      rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      now: () => currentTimeMs,
    }),
  );
  try {
    for (let index = 0; index < RATE_LIMIT_MAX; index += 1) {
      const response = await postJson(server.baseUrl, "/links", {
        url: `https://example.com/${index}`,
      });
      assert.equal(response.status, 201);
    }

    const limited = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/over",
      code: RATE_LIMITED_CODE,
    });
    assert.equal(limited.status, 429);
    const body = await limited.json();
    assert.equal(typeof body.error, "string");
    assert.ok(body.error.length > 0);

    const retryAfter = Number(limited.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfter));
    assert.ok(retryAfter >= 1);
    assert.equal(retryAfter, EXPECTED_RETRY_AFTER_SECONDS);

    assert.equal((await fetch(`${server.baseUrl}/links/${RATE_LIMITED_CODE}`)).status, 404);

    currentTimeMs = RATE_LIMIT_NEXT_WINDOW_MS;
    const afterWindow = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/next-window",
      code: RATE_LIMITED_CODE,
    });
    assert.equal(afterWindow.status, 201);
  } finally {
    await server.close();
  }
});

test("redirects and stats are never rate limited", async () => {
  const server = await startServer(
    createTestApp({
      rateLimitMax: 1,
      rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      now: () => RATE_LIMIT_WITHIN_WINDOW_MS,
    }),
  );
  try {
    const created = await postJson(server.baseUrl, "/links", {
      url: STATS_URL,
      code: STATS_CODE,
    });
    assert.equal(created.status, 201);

    const limited = await postJson(server.baseUrl, "/links", {
      url: "https://example.com/blocked",
    });
    assert.equal(limited.status, 429);

    for (let index = 0; index < 5; index += 1) {
      const redirect = await fetch(`${server.baseUrl}/${STATS_CODE}`, {
        redirect: "manual",
      });
      assert.equal(redirect.status, 302);

      const stats = await fetch(`${server.baseUrl}/links/${STATS_CODE}/stats`);
      assert.equal(stats.status, 200);
    }

    const finalStats = await fetch(`${server.baseUrl}/links/${STATS_CODE}/stats`);
    assert.equal((await finalStats.json()).totalClicks, 5);
  } finally {
    await server.close();
  }
});
