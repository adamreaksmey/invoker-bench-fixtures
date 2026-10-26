import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { parseFrontMatter } from "../src/pages.js";
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

function makeApp(pagesDir) {
  return createApp({ pagesDir, indexPath: join(pagesDir, "index.sqlite") });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const server = await startServer(makeApp(makePagesDir()));
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

test("parses front matter and applies title precedence", () => {
  assert.deepEqual(parseFrontMatter("---\ntitle: Deploy guide\ntags: [ops, Deploy, ops]\n---\n# Ignored\nBody\n"), {
    title: "Deploy guide", tags: ["deploy", "ops"], body: "# Ignored\nBody\n",
  });
  assert.deepEqual(parseFrontMatter("---\ntags: ops, Deploy\n---\n# Heading\n"), {
    title: undefined, tags: ["deploy", "ops"], body: "# Heading\n",
  });
});

test("synchronizes files, searches with ranking, and serves tags", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "deploy.md"), "---\ntitle: Deploy Guide\ntags: ops, Deploy, ops\n---\nDeploy the service safely.\n");
  writeFileSync(join(pagesDir, "ops.md"), "---\ntags: ops\n---\nOperations and deploy notes.\n");
  writeFileSync(join(pagesDir, "title-hit.md"), "---\ntitle: Deploy Alpha\n---\nA short note.\n");
  writeFileSync(join(pagesDir, "body-hit.md"), "A deploy alpha note with deploy repeated.\n");
  const indexPath = join(pagesDir, "index.sqlite");
  const server = await startServer(createApp({ pagesDir, indexPath }));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags`)).json(), [
      { tag: "ops", count: 2 }, { tag: "deploy", count: 1 },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/DEPLOY`)).json(), [{ slug: "deploy", title: "Deploy Guide" }]);
    const search = await (await fetch(`${server.baseUrl}/search?q=deploy service`)).json();
    assert.equal(search.results[0].slug, "deploy");
    assert.equal(typeof search.results[0].score, "number");
    assert.match(search.results[0].snippet, /\*\*Deploy\*\*/i);
    const ranked = await (await fetch(`${server.baseUrl}/search?q=alpha`)).json();
    assert.deepEqual(ranked.results.slice(0, 2).map(({ slug }) => slug), ["title-hit", "body-hit"]);
    assert.equal((await fetch(`${server.baseUrl}/search?q=%22deploy%20service%21`)).status, 200);
  } finally {
    await server.close();
  }

  unlinkSync(join(pagesDir, "ops.md"));
  writeFileSync(join(pagesDir, "deploy.md"), "# Changed\nChanged body\n");
  const restarted = await startServer(createApp({ pagesDir, indexPath }));
  try {
    assert.deepEqual((await (await fetch(`${restarted.baseUrl}/pages`)).json()).map(({ slug }) => slug), ["body-hit", "deploy", "title-hit", "welcome"]);
    assert.deepEqual(await (await fetch(`${restarted.baseUrl}/tags`)).json(), []);
    assert.equal((await (await fetch(`${restarted.baseUrl}/search?q=Operations`)).json()).results.length, 0);
  } finally {
    await restarted.close();
  }
});

test("rejects missing search query", async () => {
  const server = await startServer(makeApp(makePagesDir()));
  try {
    assert.equal((await fetch(`${server.baseUrl}/search`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/search?q=%20%20`)).status, 400);
  } finally {
    await server.close();
  }
});
