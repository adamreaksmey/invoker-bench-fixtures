import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { parsePageContent, normalizeTags } from "../src/pages.js";
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
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages`)).json(), [
      { slug: "welcome", title: "Welcome", tags: [] },
    ]);
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

test("normalizeTags trims, lowercases, deduplicates, and sorts", () => {
  assert.deepEqual(normalizeTags("[ops, Deploy, ops]"), ["deploy", "ops"]);
  assert.deepEqual(normalizeTags("ops, deploy"), ["deploy", "ops"]);
  assert.deepEqual(normalizeTags("  Alpha , beta,ALPHA "), ["alpha", "beta"]);
  assert.deepEqual(normalizeTags(""), []);
  assert.deepEqual(normalizeTags(undefined), []);
});

test("parsePageContent prefers front-matter title over heading and slug", () => {
  const withFrontMatter = parsePageContent(
    "deploy",
    "---\ntitle: Deploy guide\ntags: [ops, Deploy, ops]\n---\n\n# Ignored heading\nBody text.\n",
  );
  assert.equal(withFrontMatter.title, "Deploy guide");
  assert.deepEqual(withFrontMatter.tags, ["deploy", "ops"]);
  assert.equal(withFrontMatter.body, "\n# Ignored heading\nBody text.\n");
  assert.ok(!withFrontMatter.body.includes("---"));

  const headingOnly = parsePageContent("slug-page", "# Heading Title\n\nContent.\n");
  assert.equal(headingOnly.title, "Heading Title");
  assert.deepEqual(headingOnly.tags, []);
  assert.equal(headingOnly.body, "# Heading Title\n\nContent.\n");

  const slugOnly = parsePageContent("plain-slug", "No heading here.\n");
  assert.equal(slugOnly.title, "plain-slug");
  assert.deepEqual(slugOnly.tags, []);
});

test("parsePageContent accepts comma-form tags", () => {
  const page = parsePageContent(
    "ops",
    "---\ntitle: Ops\ntags: ops, Deploy\n---\nBody only.\n",
  );
  assert.deepEqual(page.tags, ["deploy", "ops"]);
  assert.equal(page.body, "Body only.\n");
});

test("GET /pages and GET /pages/:slug include tags; body excludes front matter", async () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(
    join(pagesDir, "deploy.md"),
    "---\ntitle: Deploy guide\ntags: [ops, Deploy, ops]\n---\n\nShip it.\n",
  );
  const server = await startServer(createApp({ pagesDir }));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages`)).json(), [
      { slug: "deploy", title: "Deploy guide", tags: ["deploy", "ops"] },
    ]);
    const page = await (await fetch(`${server.baseUrl}/pages/deploy`)).json();
    assert.equal(page.title, "Deploy guide");
    assert.deepEqual(page.tags, ["deploy", "ops"]);
    assert.equal(page.body, "\nShip it.\n");
    assert.ok(!page.body.includes("title:"));
  } finally {
    await server.close();
  }
});

test("PUT returns page with parsed front matter tags and title", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    const response = await putPage(
      server.baseUrl,
      "runbook",
      "---\ntitle: Runbook\ntags: a, B, a\n---\nSteps.\n",
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      slug: "runbook",
      title: "Runbook",
      tags: ["a", "b"],
      body: "Steps.\n",
    });
  } finally {
    await server.close();
  }
});
