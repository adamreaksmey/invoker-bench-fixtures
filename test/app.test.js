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

test("search finds pages containing the query", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=Start`)).json();
    assert.deepEqual(response.results.map((result) => result.slug), ["welcome"]);
  } finally {
    await server.close();
  }
});

test("GET /pages includes tags from front matter", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "deploy-guide.md"), "---\ntitle: Deploy guide\ntags: ops, deploy\n---\n# Deploy guide\n\nRun the pipeline.\n");
  const server = await startServer(createApp({ pagesDir }));
  try {
    const pages = await (await fetch(`${server.baseUrl}/pages`)).json();
    assert.deepEqual(pages, [
      { slug: "deploy-guide", title: "Deploy guide", tags: ["deploy", "ops"] },
      { slug: "welcome", title: "Welcome", tags: [] },
    ]);
  } finally {
    await server.close();
  }
});

test("GET /pages/:slug returns parsed front matter and excludes it from body", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "guide.md"), "---\ntitle: Deploy guide\ntags: [ops, Deploy, ops]\n---\n# Deploy guide\n\nRun the pipeline.\n");
  const server = await startServer(createApp({ pagesDir }));
  try {
    const page = await (await fetch(`${server.baseUrl}/pages/guide`)).json();
    assert.deepEqual(page, {
      slug: "guide",
      title: "Deploy guide",
      tags: ["deploy", "ops"],
      body: "# Deploy guide\n\nRun the pipeline.\n",
    });
  } finally {
    await server.close();
  }
});

test("title falls back to heading then slug", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "heading-only.md"), "# Heading title\n\nBody.\n");
  writeFileSync(join(pagesDir, "no-title.md"), "Body without heading.\n");
  const server = await startServer(createApp({ pagesDir }));
  try {
    const headingOnly = await (await fetch(`${server.baseUrl}/pages/heading-only`)).json();
    const noTitle = await (await fetch(`${server.baseUrl}/pages/no-title`)).json();
    assert.equal(headingOnly.title, "Heading title");
    assert.equal(noTitle.title, "no-title");
  } finally {
    await server.close();
  }
});

test("PUT stores full markdown and response excludes front matter from body", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    const putResponse = await putPage(server.baseUrl, "new-page", "---\ntitle: New page\ntags: a, b\n---\n# New page\n\nContent.\n");
    assert.equal(putResponse.status, 201);
    const page = await putResponse.json();
    assert.deepEqual(page.tags, ["a", "b"]);
    assert.equal(page.body, "# New page\n\nContent.\n");
  } finally {
    await server.close();
  }
});
