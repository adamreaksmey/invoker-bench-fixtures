import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { startServer } from "./helpers.js";

function makePagesDir() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), "---\ntitle: Welcome to the wiki\ntags: [onboarding, docs]\n---\n# Welcome\n\nStart here.\n");
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
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages`)).json(), [{
      slug: "welcome",
      title: "Welcome to the wiki",
      tags: ["docs", "onboarding"],
    }]);
    assert.equal((await putPage(server.baseUrl, "notes", "# Notes\n")).status, 201);
    assert.equal((await putPage(server.baseUrl, "notes", "# Notes v2\n")).status, 200);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages/notes`)).json(), {
      slug: "notes",
      title: "Notes v2",
      tags: [],
      body: "# Notes v2\n",
    });
    assert.equal((await fetch(`${server.baseUrl}/pages/notes`, { method: "DELETE" })).status, 204);
    assert.equal((await fetch(`${server.baseUrl}/pages/notes`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/pages/Bad_Slug`)).status, 400);
  } finally {
    await server.close();
  }
});

test("parses front matter and applies title precedence", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "heading.md"), "# Heading title\n\nBody\n");
  writeFileSync(join(pagesDir, "slug-only.md"), "Body without a heading\n");
  writeFileSync(join(pagesDir, "front-matter.md"), "---\n title: Front matter title\ntags: [Ops, deploy, ops,  Docs ]\n---\n# Markdown title\n\nContent\n");
  const server = await startServer(createApp({ pagesDir }));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages/front-matter`)).json(), {
      slug: "front-matter",
      title: "Front matter title",
      tags: ["deploy", "docs", "ops"],
      body: "# Markdown title\n\nContent\n",
    });
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages/heading`)).json(), {
      slug: "heading",
      title: "Heading title",
      tags: [],
      body: "# Heading title\n\nBody\n",
    });
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages/slug-only`)).json(), {
      slug: "slug-only",
      title: "slug-only",
      tags: [],
      body: "Body without a heading\n",
    });
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
