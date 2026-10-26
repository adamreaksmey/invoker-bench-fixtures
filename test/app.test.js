import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { startServer } from "./helpers.js";

function makePagesDir() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), "---\ntitle: Welcome to the wiki\ntags: [onboarding, docs]\n---\n# Welcome\n\nStart here.\n");
  return dir;
}

function makeIndexPath() {
  return join(mkdtempSync(join(tmpdir(), "wiki-index-")), "index.sqlite");
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const app = createApp({ pagesDir: makePagesDir(), indexPath: makeIndexPath() });
  const server = await startServer(app);
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
    app.locals.close();
  }
});

test("parses front matter and applies title precedence", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "heading.md"), "# Heading title\n\nBody\n");
  writeFileSync(join(pagesDir, "slug-only.md"), "Body without a heading\n");
  writeFileSync(join(pagesDir, "front-matter.md"), "---\n title: Front matter title\ntags: [Ops, deploy, ops,  Docs ]\n---\n# Markdown title\n\nContent\n");
  const app = createApp({ pagesDir, indexPath: makeIndexPath() });
  const server = await startServer(app);
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
    app.locals.close();
  }
});

test("search finds pages containing the query", async () => {
  const app = createApp({ pagesDir: makePagesDir(), indexPath: makeIndexPath() });
  const server = await startServer(app);
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=Start`)).json();
    assert.deepEqual(response.results.map((result) => result.slug), ["welcome"]);
  } finally {
    await server.close();
    app.locals.close();
  }
});

test("search ANDs every term and treats punctuation as plain text", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "both-terms.md"), "# Deploy guide\n\nDeploy this guide safely.\n");
  writeFileSync(join(pagesDir, "one-term.md"), "# Deploy only\n\nDeploy this page.\n");
  const app = createApp({ pagesDir, indexPath: makeIndexPath() });
  const server = await startServer(app);
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=%22DEPLOY%22%20%2Fguide%2F%21`)).json();
    assert.deepEqual(response.results.map(({ slug }) => slug), ["both-terms"]);
    assert.match(response.results[0].snippet, /\*\*Deploy\*\*/i);
    assert.equal((await fetch(`${server.baseUrl}/search?q=!!!%20%22%22`)).status, 200);
  } finally {
    await server.close();
    app.locals.close();
  }
});

test("synchronizes changed, added, and removed files when reopening the app", async () => {
  const pagesDir = makePagesDir();
  const indexPath = makeIndexPath();
  let app = createApp({ pagesDir, indexPath });
  app.locals.close();
  writeFileSync(join(pagesDir, "welcome.md"), "---\ntitle: Updated\ntags: [ops]\n---\nUpdated body\n");
  writeFileSync(join(pagesDir, "new-page.md"), "# New page\n\nNew body\n");
  rmSync(join(pagesDir, "welcome.md"));
  app = createApp({ pagesDir, indexPath });
  const server = await startServer(app);
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages`)).json(), [{
      slug: "new-page", title: "New page", tags: [],
    }]);
    assert.deepEqual((await (await fetch(`${server.baseUrl}/search?q=updated`)).json()).results, []);
  } finally {
    await server.close();
    app.locals.close();
  }
});

test("ranks title matches above body matches and returns safe snippets", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "title-match.md"), "---\ntitle: Needle guide\n---\nNeedle appears once.\n");
  writeFileSync(join(pagesDir, "body-match.md"), "A needle appears in this body. Needle appears again.\n");
  const app = createApp({ pagesDir, indexPath: makeIndexPath() });
  const server = await startServer(app);
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=NEEDLE%20%22guide%22`)).json();
    assert.equal(response.results[0].slug, "title-match");
    const needle = await (await fetch(`${server.baseUrl}/search?q=needle`)).json();
    assert.equal(needle.results[0].slug, "title-match");
    assert.match(needle.results[0].snippet, /\*\*needle\*\*/i);
    assert.equal(typeof needle.results[0].score, "number");
    assert.equal((await fetch(`${server.baseUrl}/search?q=%22%5B%5D`)).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/search`)).status, 400);
  } finally {
    await server.close();
    app.locals.close();
  }
});

test("lists tags and finds pages by tag case-insensitively", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "second.md"), "---\ntitle: Second\ntags: ops, docs\n---\nBody\n");
  writeFileSync(join(pagesDir, "first.md"), "---\ntitle: First\ntags: OPS\n---\nBody\n");
  const app = createApp({ pagesDir, indexPath: makeIndexPath() });
  const server = await startServer(app);
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags`)).json(), [
      { tag: "docs", count: 2 },
      { tag: "ops", count: 2 },
      { tag: "onboarding", count: 1 },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/OPS`)).json(), [
      { slug: "first", title: "First" },
      { slug: "second", title: "Second" },
    ]);
    assert.equal((await putPage(server.baseUrl, "second", "---\ntitle: Updated second\ntags: docs\n---\nBody\n")).status, 200);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/OPS`)).json(), [{ slug: "first", title: "First" }]);
    assert.equal((await fetch(`${server.baseUrl}/pages/first`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/OPS`)).json(), []);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/missing`)).json(), []);
  } finally {
    await server.close();
    app.locals.close();
  }
});
