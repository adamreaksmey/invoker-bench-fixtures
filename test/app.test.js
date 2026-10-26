import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("front matter does not override title precedence when title is blank", async () => {
  const server = await startServer(createApp({ pagesDir: makePagesDir() }));
  try {
    const response = await putPage(server.baseUrl, "heading-fallback", "---\ntitle:   \ntags: [ Ops, ops, Deploy ]\n---\n# Heading title\n\nBody text.\n");
    assert.deepEqual(await response.json(), {
      slug: "heading-fallback",
      title: "Heading title",
      tags: ["deploy", "ops"],
      body: "# Heading title\n\nBody text.\n",
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

test("synchronizes the index across app restarts and supports tags", async () => {
  const pagesDir = makePagesDir();
  const indexPath = join(mkdtempSync(join(tmpdir(), "wiki-index-")), "index.sqlite");
  const first = createApp({ pagesDir, indexPath });
  first.locals.close();
  rmSync(join(pagesDir, "welcome.md"));
  writeFileSync(join(pagesDir, "ops.md"), "---\ntitle: Operations\ntags: Ops, runbook\n---\n# Runbook\nRestart the service safely.\n");
  const server = await startServer(createApp({ pagesDir, indexPath }));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags`)).json(), [
      { tag: "ops", count: 1 },
      { tag: "runbook", count: 1 },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/OPS`)).json(), [{ slug: "ops", title: "Operations" }]);
    assert.equal((await fetch(`${server.baseUrl}/pages/welcome`)).status, 404);
    assert.deepEqual((await (await fetch(`${server.baseUrl}/search?q=restart%20%22service%22`)).json()).results.map(({ slug }) => slug), ["ops"]);
  } finally {
    await server.close();
  }
});

test("create, update, and delete keep search and tags indexes current before responding", async () => {
  const pagesDir = makePagesDir();
  const server = await startServer(createApp({ pagesDir, indexPath: join(mkdtempSync(join(tmpdir(), "wiki-index-")), "index.sqlite") }));
  try {
    const created = await putPage(server.baseUrl, "draft", "---\ntitle: First draft\ntags: alpha\n---\nA rareword appears here.\n");
    assert.equal(created.status, 201);
    assert.deepEqual((await (await fetch(`${server.baseUrl}/search?q=rareword`)).json()).results.map(({ slug }) => slug), ["draft"]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/alpha`)).json(), [{ slug: "draft", title: "First draft" }]);

    const updated = await putPage(server.baseUrl, "draft", "---\ntitle: Second draft\ntags: beta\n---\nA differentword appears here.\n");
    assert.equal(updated.status, 200);
    assert.deepEqual((await (await fetch(`${server.baseUrl}/search?q=rareword`)).json()).results, []);
    assert.deepEqual((await (await fetch(`${server.baseUrl}/search?q=differentword`)).json()).results.map(({ slug }) => slug), ["draft"]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/alpha`)).json(), []);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/beta`)).json(), [{ slug: "draft", title: "Second draft" }]);

    assert.equal((await fetch(`${server.baseUrl}/pages/draft`, { method: "DELETE" })).status, 204);
    assert.deepEqual((await (await fetch(`${server.baseUrl}/search?q=differentword`)).json()).results, []);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/beta`)).json(), []);
  } finally {
    await server.close();
  }
});

test("tag endpoints count and sort tags, and return pages case-insensitively by slug", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "zebra.md"), "---\ntitle: Zebra page\ntags: Alpha, shared\n---\n# Zebra\n");
  writeFileSync(join(pagesDir, "apple.md"), "---\ntitle: Apple page\ntags: shared, Beta\n---\n# Apple\n");
  writeFileSync(join(pagesDir, "middle.md"), "---\ntitle: Middle page\ntags: alpha, shared\n---\n# Middle\n");
  const server = await startServer(createApp({ pagesDir, indexPath: join(mkdtempSync(join(tmpdir(), "wiki-index-")), "index.sqlite") }));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags`)).json(), [
      { tag: "shared", count: 3 },
      { tag: "alpha", count: 2 },
      { tag: "beta", count: 1 },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/AlPhA`)).json(), [
      { slug: "middle", title: "Middle page" },
      { slug: "zebra", title: "Zebra page" },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/missing`)).json(), []);
  } finally {
    await server.close();
  }
});

test("search ranks title matches, highlights body matches, and validates q", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "title-match.md"), "# Deploy guide\nA general note.\n");
  writeFileSync(join(pagesDir, "body-match.md"), "# Other\nDeploy the service with care.\n");
  const server = await startServer(createApp({ pagesDir, indexPath: join(mkdtempSync(join(tmpdir(), "wiki-index-")), "index.sqlite") }));
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=deploy`)).json();
    assert.equal(response.results[0].slug, "title-match");
    assert.match(response.results[1].snippet, /\*\*Deploy\*\*/);
    assert.equal(typeof response.results[0].score, "number");
    assert.equal((await fetch(`${server.baseUrl}/search`)).status, 400);
    assert.equal((await fetch(`${server.baseUrl}/search?q=%22!!!`)).status, 200);
  } finally {
    await server.close();
  }
});

test("search uses case-insensitive AND terms, ignores punctuation, and caps results", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "both-terms.md"), "# Deploy Service\nDeploy the service safely.\n");
  writeFileSync(join(pagesDir, "one-term.md"), "# Deploy\nOnly one term appears here.\n");
  for (let i = 0; i < 21; i += 1) {
    writeFileSync(join(pagesDir, `extra-${String(i).padStart(2, "0")}.md`), `# Extra ${i}\nDeploy service ${i}.\n`);
  }
  const server = await startServer(createApp({ pagesDir, indexPath: join(mkdtempSync(join(tmpdir(), "wiki-index-")), "index.sqlite") }));
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=DEPLOY%20%22SERVICE%22!!!`)).json();
    assert.equal(response.query, 'DEPLOY "SERVICE"!!!');
    assert.equal(response.results.length, 20);
    assert.equal(response.results.some(({ slug }) => slug === "one-term"), false);
    assert.equal(response.results[0].slug, "both-terms");
    assert.match(response.results[0].snippet, /\*\*Deploy\*\*/);
    assert.match(response.results[0].snippet, /\*\*service\*\*/i);
  } finally {
    await server.close();
  }
});
