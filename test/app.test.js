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

function makeIndexPath() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-index-"));
  return join(dir, "index.sqlite");
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir(), indexPath: makeIndexPath() }));
  try {
    assert.deepEqual(
      await (await fetch(`${server.baseUrl}/pages`)).json(),
      [{ slug: "welcome", title: "Welcome", tags: [] }],
    );
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

test("search finds pages containing the query", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir(), indexPath: makeIndexPath() }));
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=Start`)).json();
    assert.deepEqual(response.results.map((result) => result.slug), ["welcome"]);
  } finally {
    await server.close();
  }
});

test("search returns 400 for missing or blank query", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir(), indexPath: makeIndexPath() }));
  try {
    assert.equal((await fetch(`${server.baseUrl}/search`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/search?q=`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/search?q=%20`)).status, 400);
  } finally {
    await server.close();
  }
});

test("tags are included in page responses", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "deploy.md"), "---\ntitle: Deploy\ntags: [ops, deploy]\n---\n# Deploy\n\nRun.");
  const server = await startServer(createApp({ pagesDir, indexPath: makeIndexPath() }));
  try {
    const list = await (await fetch(`${server.baseUrl}/pages`)).json();
    const deploy = list.find((page) => page.slug === "deploy");
    assert.deepEqual(deploy.tags, ["deploy", "ops"]);
    const page = await (await fetch(`${server.baseUrl}/pages/deploy`)).json();
    assert.deepEqual(page.tags, ["deploy", "ops"]);
  } finally {
    await server.close();
  }
});

test("PUT and DELETE keep the search index up to date", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir(), indexPath: makeIndexPath() }));
  try {
    await putPage(server.baseUrl, "new", "# New page\n\nUnique phrase xyz.");
    const searchAfterPut = await (await fetch(`${server.baseUrl}/search?q=Unique%20phrase%20xyz`)).json();
    assert.equal(searchAfterPut.results.length, 1);

    await fetch(`${server.baseUrl}/pages/new`, { method: "DELETE" });
    const searchAfterDelete = await (await fetch(`${server.baseUrl}/search?q=Unique%20phrase%20xyz`)).json();
    assert.equal(searchAfterDelete.results.length, 0);
  } finally {
    await server.close();
  }
});

test("tags endpoints return aggregated and filtered tags", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "a.md"), "---\ntags: [x, y]\n---\n# A");
  writeFileSync(join(pagesDir, "b.md"), "---\ntags: [x]\n---\n# B");
  const server = await startServer(createApp({ pagesDir, indexPath: makeIndexPath() }));
  try {
    const tags = await (await fetch(`${server.baseUrl}/tags`)).json();
    assert.deepEqual(tags, [
      { tag: "x", count: 2 },
      { tag: "y", count: 1 },
    ]);
    const pages = await (await fetch(`${server.baseUrl}/tags/X`)).json();
    assert.deepEqual(pages, [
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
    ]);
  } finally {
    await server.close();
  }
});
