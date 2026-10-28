import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { startServer } from "./helpers.js";

const MEMORY_INDEX = ":memory:";

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

function createTestApp(pagesDir) {
  return createApp({ pagesDir, indexPath: MEMORY_INDEX });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const server = await startServer(createTestApp(makePagesDir()));
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
  const server = await startServer(createTestApp(makePagesDir()));
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
  const server = await startServer(createTestApp(pagesDir));
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
  const server = await startServer(createTestApp(pagesDir));
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
  const server = await startServer(createTestApp(pagesDir));
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
  const server = await startServer(createTestApp(makePagesDir()));
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

test("search requires a non-blank query", async () => {
  const server = await startServer(createTestApp(makePagesDir()));
  try {
    const missing = await (await fetch(`${server.baseUrl}/search`)).json();
    assert.deepEqual(missing, { error: "query is required" });
    assert.equal((await fetch(`${server.baseUrl}/search?q=`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/search?q=%20`)).status, 400);
  } finally {
    await server.close();
  }
});

test("search is case-insensitive", async () => {
  const server = await startServer(createTestApp(makePagesDir()));
  try {
    const lower = await (await fetch(`${server.baseUrl}/search?q=start`)).json();
    const upper = await (await fetch(`${server.baseUrl}/search?q=START`)).json();
    assert.deepEqual(lower.results.map((result) => result.slug), ["welcome"]);
    assert.deepEqual(upper.results.map((result) => result.slug), ["welcome"]);
  } finally {
    await server.close();
  }
});

test("search requires all terms to match", async () => {
  const server = await startServer(createTestApp(makePagesDir()));
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=Start%20here`)).json();
    assert.deepEqual(response.results.map((result) => result.slug), ["welcome"]);
    const noMatch = await (await fetch(`${server.baseUrl}/search?q=Start%20nowhere`)).json();
    assert.deepEqual(noMatch.results, []);
  } finally {
    await server.close();
  }
});

test("search ranks title matches above body matches with numeric scores", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "body-match.md"), "# Irrelevant title\n\nStart here with important content.\n");
  writeFileSync(join(pagesDir, "title-match.md"), "# Start here\n\nIrrelevant body.\n");
  const server = await startServer(createTestApp(pagesDir));
  try {
    const { results } = await (await fetch(`${server.baseUrl}/search?q=Start`)).json();
    assert.deepEqual(results.map((result) => result.slug), ["title-match", "welcome", "body-match"]);
    const scores = results.map((result) => result.score);
    assert.ok(scores.every((score) => typeof score === "number"));
    assert.ok(scores[0] > scores[1]);
    assert.ok(scores[1] > scores[2]);
  } finally {
    await server.close();
  }
});

test("search treats punctuation and quotes as plain text", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "punctuation.md"), "# Punctuation\n\nHello \"world\" and can't-stop.\n");
  const server = await startServer(createTestApp(pagesDir));
  try {
    const queries = ['"hello', "can't", "\"world\"", "-stop", "!!!"];
    for (const q of queries) {
      const response = await fetch(`${server.baseUrl}/search?q=${encodeURIComponent(q)}`);
      assert.equal(response.status, 200, `query ${q} should not error`);
    }
    const quoted = await (await fetch(`${server.baseUrl}/search?q=${encodeURIComponent('"world"')}`)).json();
    assert.ok(quoted.results.some((result) => result.slug === "punctuation"));
    assert.ok(quoted.results[0].snippet.includes("**world**"));
  } finally {
    await server.close();
  }
});

test("GET /tags lists tags sorted by count then name", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "a.md"), "---\ntags: [shared, alpha]\n---\n# A\n");
  writeFileSync(join(pagesDir, "b.md"), "---\ntags: [shared, beta]\n---\n# B\n");
  writeFileSync(join(pagesDir, "c.md"), "---\ntags: [shared]\n---\n# C\n");
  const server = await startServer(createTestApp(pagesDir));
  try {
    const tags = await (await fetch(`${server.baseUrl}/tags`)).json();
    assert.deepEqual(tags, [
      { tag: "shared", count: 3 },
      { tag: "alpha", count: 1 },
      { tag: "beta", count: 1 },
    ]);
  } finally {
    await server.close();
  }
});

test("GET /tags/:tag returns pages for a tag", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "tagged.md"), "---\ntags: [Ops]\n---\n# Tagged\n");
  const server = await startServer(createTestApp(pagesDir));
  try {
    const pages = await (await fetch(`${server.baseUrl}/tags/ops`)).json();
    assert.deepEqual(pages, [{ slug: "tagged", title: "Tagged" }]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/unknown`)).json(), []);
  } finally {
    await server.close();
  }
});

test("index is updated by PUT before responding", async () => {
  const pagesDir = makePagesDir();
  const server = await startServer(createTestApp(pagesDir));
  try {
    await putPage(server.baseUrl, "indexed", "# Indexed\n\nUnique searchable phrase xyzabc.\n");
    const { results } = await (await fetch(`${server.baseUrl}/search?q=xyzabc`)).json();
    assert.deepEqual(results.map((result) => result.slug), ["indexed"]);
  } finally {
    await server.close();
  }
});

test("index is updated by DELETE before responding", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "remove-me.md"), "# Remove me\n\nDelete phrase xyzabc.\n");
  const server = await startServer(createTestApp(pagesDir));
  try {
    await fetch(`${server.baseUrl}/pages/remove-me`, { method: "DELETE" });
    const { results } = await (await fetch(`${server.baseUrl}/search?q=xyzabc`)).json();
    assert.deepEqual(results, []);
  } finally {
    await server.close();
  }
});

test("index synchronizes with directory on startup", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "old.md"), "# Old\n\nOld phrase xyzabc.\n");
  const server = await startServer(createTestApp(pagesDir));
  try {
    await server.close();
    rmSync(join(pagesDir, "old.md"));
    writeFileSync(join(pagesDir, "new.md"), "# New\n\nNew phrase xyzabc.\n");
    const nextServer = await startServer(createTestApp(pagesDir));
    try {
      const { results } = await (await fetch(`${nextServer.baseUrl}/search?q=xyzabc`)).json();
      assert.deepEqual(results.map((result) => result.slug), ["new"]);
    } finally {
      await nextServer.close();
    }
  } finally {
    await server.close();
  }
});
