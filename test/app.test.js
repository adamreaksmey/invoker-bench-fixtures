import { test } from "node:test";
import assert from "node:assert/strict";
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

test("persists links across app instances", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const directory = await mkdtemp("/tmp/link-shortener-");
  const databasePath = join(directory, "links.sqlite");
  const firstApp = createApp({ databasePath });
  const firstServer = await startServer(firstApp);

  try {
    await postJson(firstServer.baseUrl, "/links", {
      url: "https://example.com/persisted",
      code: "saved",
    });
  } finally {
    await firstServer.close();
    firstApp.locals.close();
  }

  const secondApp = createApp({ databasePath });
  const secondServer = await startServer(secondApp);
  try {
    const response = await fetch(`${secondServer.baseUrl}/links/saved`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).url, "https://example.com/persisted");
  } finally {
    await secondServer.close();
    secondApp.locals.close();
    await rm(directory, { recursive: true, force: true });
  }
});
