import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { createTemporaryApp, createTemporaryDatabasePath, postJson, startServer } from "./helpers.js";

const FIRST_CLICK_MS = Date.UTC(2026, 0, 2, 3, 4, 5);
const SECOND_CLICK_MS = Date.UTC(2026, 0, 2, 23, 59, 59);
const NEXT_DAY_CLICK_MS = Date.UTC(2026, 0, 3, 0, 0, 0, 1);
const UNKNOWN_CODE = "missing";

function createSettableClock(initialMs) {
  let currentMs = initialMs;
  return {
    now: () => currentMs,
    set(nextMs) {
      currentMs = nextMs;
    },
  };
}

async function createLink(server, code) {
  const response = await postJson(server.baseUrl, "/links", {
    url: "https://example.com/analytics",
    code,
  });
  assert.equal(response.status, 201);
}

function followRedirect(server, code, referer) {
  const headers = referer === undefined ? {} : { referer };
  return fetch(`${server.baseUrl}/${code}`, { redirect: "manual", headers });
}

async function readStats(server, code) {
  const response = await fetch(`${server.baseUrl}/links/${code}/stats`);
  return { status: response.status, body: await response.json() };
}

test("a redirect records a click with the injected timestamp and Referer header", async () => {
  const clock = createSettableClock(FIRST_CLICK_MS);
  const temporaryApp = createTemporaryApp({ now: clock.now });
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "referer");
    const redirect = await followRedirect(server, "referer", "https://source.example/page");
    assert.equal(redirect.status, 302);

    const stats = await readStats(server, "referer");
    assert.equal(stats.status, 200);
    assert.equal(stats.body.totalClicks, 1);
    assert.equal(stats.body.lastClickedAt, new Date(FIRST_CLICK_MS).toISOString());
    assert.deepEqual(readRecordedClicks(temporaryApp.databasePath, "referer"), [
      { clicked_at_ms: FIRST_CLICK_MS, referer: "https://source.example/page" },
    ]);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

function readRecordedClicks(databasePath, code) {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare("SELECT clicked_at_ms, referer FROM clicks WHERE code = ? ORDER BY id")
      .all(code)
      .map((row) => ({ clicked_at_ms: row.clicked_at_ms, referer: row.referer }));
  } finally {
    database.close();
  }
}

test("a redirect without a Referer header records a null referer", async () => {
  const temporaryApp = createTemporaryApp({ now: () => FIRST_CLICK_MS });
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "noref");
    await followRedirect(server, "noref");

    assert.deepEqual(readRecordedClicks(temporaryApp.databasePath, "noref"), [
      { clicked_at_ms: FIRST_CLICK_MS, referer: null },
    ]);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("stats report zero clicks for a link that was never followed", async () => {
  const temporaryApp = createTemporaryApp();
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "quiet");
    const stats = await readStats(server, "quiet");
    assert.equal(stats.status, 200);
    assert.deepEqual(stats.body, {
      code: "quiet",
      url: "https://example.com/analytics",
      totalClicks: 0,
      lastClickedAt: null,
      clicksByDay: {},
    });
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("stats group clicks into UTC calendar days", async () => {
  const clock = createSettableClock(FIRST_CLICK_MS);
  const temporaryApp = createTemporaryApp({ now: clock.now });
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "grouped");
    await followRedirect(server, "grouped");
    clock.set(SECOND_CLICK_MS);
    await followRedirect(server, "grouped");
    clock.set(NEXT_DAY_CLICK_MS);
    await followRedirect(server, "grouped");

    const stats = await readStats(server, "grouped");
    assert.equal(stats.body.totalClicks, 3);
    assert.equal(stats.body.lastClickedAt, new Date(NEXT_DAY_CLICK_MS).toISOString());
    assert.deepEqual(stats.body.clicksByDay, { "2026-01-02": 2, "2026-01-03": 1 });
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("stats requests do not count as clicks", async () => {
  const temporaryApp = createTemporaryApp({ now: () => FIRST_CLICK_MS });
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "notaclick");
    await followRedirect(server, "notaclick");
    await readStats(server, "notaclick");
    await readStats(server, "notaclick");

    const stats = await readStats(server, "notaclick");
    assert.equal(stats.body.totalClicks, 1);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("stats return 404 for an unknown code", async () => {
  const temporaryApp = createTemporaryApp();
  const server = await startServer(temporaryApp.app);
  try {
    const stats = await readStats(server, UNKNOWN_CODE);
    assert.equal(stats.status, 404);
    assert.equal(typeof stats.body.error, "string");
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("clicks persist across app restarts on the same database file", async () => {
  const temporaryDatabase = createTemporaryDatabasePath();
  const clock = createSettableClock(FIRST_CLICK_MS);
  const firstApp = createApp({
    databasePath: temporaryDatabase.databasePath,
    now: clock.now,
  });
  const firstServer = await startServer(firstApp);
  try {
    await createLink(firstServer, "persisted");
    await followRedirect(firstServer, "persisted");
    clock.set(SECOND_CLICK_MS);
    await followRedirect(firstServer, "persisted");
  } finally {
    await firstServer.close();
  }

  const reopenedApp = createApp({ databasePath: temporaryDatabase.databasePath });
  const reopenedServer = await startServer(reopenedApp);
  try {
    const stats = await readStats(reopenedServer, "persisted");
    assert.equal(stats.status, 200);
    assert.equal(stats.body.totalClicks, 2);
    assert.equal(stats.body.lastClickedAt, new Date(SECOND_CLICK_MS).toISOString());
    assert.deepEqual(stats.body.clicksByDay, { "2026-01-02": 2 });
  } finally {
    await reopenedServer.close();
    temporaryDatabase.remove();
  }
});

test("redirecting an unknown code records no click and returns 404", async () => {
  const temporaryApp = createTemporaryApp();
  const server = await startServer(temporaryApp.app);
  try {
    const redirect = await followRedirect(server, UNKNOWN_CODE);
    assert.equal(redirect.status, 404);
    assert.equal((await readStats(server, UNKNOWN_CODE)).status, 404);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("clicks are attributed to the redirected link only", async () => {
  const clock = createSettableClock(FIRST_CLICK_MS);
  const temporaryApp = createTemporaryApp({ now: clock.now });
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "clicked");
    await createLink(server, "untouched");
    await followRedirect(server, "clicked");
    clock.set(SECOND_CLICK_MS);
    await followRedirect(server, "clicked");

    const clickedStats = await readStats(server, "clicked");
    assert.equal(clickedStats.body.totalClicks, 2);

    const untouchedStats = await readStats(server, "untouched");
    assert.equal(untouchedStats.body.totalClicks, 0);
    assert.equal(untouchedStats.body.lastClickedAt, null);
    assert.deepEqual(untouchedStats.body.clicksByDay, {});
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("clicksByDay keys are UTC YYYY-MM-DD dates in ascending order", async () => {
  const EARLIEST_CLICK_MS = Date.UTC(2025, 11, 31, 23, 59, 59, 999);
  const clock = createSettableClock(NEXT_DAY_CLICK_MS);
  const temporaryApp = createTemporaryApp({ now: clock.now });
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "ordered");
    await followRedirect(server, "ordered");
    clock.set(EARLIEST_CLICK_MS);
    await followRedirect(server, "ordered");
    clock.set(SECOND_CLICK_MS);
    await followRedirect(server, "ordered");

    const stats = await readStats(server, "ordered");
    assert.deepEqual(Object.keys(stats.body.clicksByDay), [
      "2025-12-31",
      "2026-01-02",
      "2026-01-03",
    ]);
    for (const dayKey of Object.keys(stats.body.clicksByDay)) {
      assert.match(dayKey, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.deepEqual(stats.body.clicksByDay, {
      "2025-12-31": 1,
      "2026-01-02": 1,
      "2026-01-03": 1,
    });
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("stats report an ISO lastClickedAt for the most recent click", async () => {
  const clock = createSettableClock(FIRST_CLICK_MS);
  const temporaryApp = createTemporaryApp({ now: clock.now });
  const server = await startServer(temporaryApp.app);
  try {
    await createLink(server, "latest");
    clock.set(NEXT_DAY_CLICK_MS);
    await followRedirect(server, "latest");
    clock.set(SECOND_CLICK_MS);
    await followRedirect(server, "latest");

    const stats = await readStats(server, "latest");
    assert.equal(stats.body.lastClickedAt, new Date(NEXT_DAY_CLICK_MS).toISOString());
  } finally {
    await server.close();
    temporaryApp.close();
  }
});
