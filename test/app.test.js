import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { startServer } from "./helpers.js";

function makePagesDir() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), "# Welcome\n\nStart here.\n");
  return dir;
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages`)).json(), [{ slug: "welcome", title: "Welcome", tags: [] }]);
    assert.equal((await putPage(server.baseUrl, "notes", "# Notes\n")).status, 201);
    assert.equal((await putPage(server.baseUrl, "notes", "# Notes v2\n")).status, 200);
    assert.equal((await (await fetch(`${server.baseUrl}/pages/notes`)).json()).title, "Notes v2");
    assert.equal((await fetch(`${server.baseUrl}/pages/notes`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(`${server.baseUrl}/pages/notes`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/pages/Bad_Slug`)).status, 400);
  } finally {
    await server.close();
  }
});

test("parses front matter tags, removes it from body, and prefers its title", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    const response = await putPage(server.baseUrl, "deploy", "---\ntitle: Deploy guide\ntags: [ ops, Deploy, ops, Docs ]\n---\n# Other heading\n\nShip safely.\n");
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      slug: "deploy",
      title: "Deploy guide",
      tags: ["deploy", "docs", "ops"],
      body: "# Other heading\n\nShip safely.\n",
    });

    const list = await (await fetch(`${server.baseUrl}/pages`)).json();
    assert.deepEqual(list.find((page) => page.slug === "deploy"), {
      slug: "deploy", title: "Deploy guide", tags: ["deploy", "docs", "ops"],
    });
  } finally {
    await server.close();
  }
});

test("parses comma-separated tags and falls back to heading then slug", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    const withHeading = await (await putPage(server.baseUrl, "notes", "---\ntags: Docs, ops, docs\n---\n# Notes heading\nText\n")).json();
    assert.equal(withHeading.title, "Notes heading");
    assert.deepEqual(withHeading.tags, ["docs", "ops"]);
    assert.equal(withHeading.body, "# Notes heading\nText\n");

    const withoutHeading = await (await putPage(server.baseUrl, "plain", "---\ntags: ops, docs\n---\nJust text\n")).json();
    assert.equal(withoutHeading.title, "plain");
    assert.deepEqual(withoutHeading.tags, ["docs", "ops"]);
  } finally {
    await server.close();
  }
});

test("search finds pages containing the query", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=Start`)).json();
    assert.deepEqual(response.results.map((result) => result.slug), ["welcome"]);
  } finally {
    await server.close();
  }
});
