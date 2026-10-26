import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { parseFrontMatter, resolveTags, resolveTitle } from "../src/front-matter.js";
import { parsePageMarkdown } from "../src/pages.js";
import { startServer } from "./helpers.js";

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), "# Welcome\n\nStart here.\n");
  return {
    pagesDir: dir,
    indexPath: join(dir, "index.sqlite"),
  };
}

function createTestApp(workspace = makeWorkspace()) {
  return {
    app: createApp({
      pagesDir: workspace.pagesDir,
      indexPath: workspace.indexPath,
    }),
    workspace,
  };
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const { app } = createTestApp();
  const server = await startServer(app);
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

test("front matter supplies title, normalized tags, and stripped body", () => {
  const markdown = `---
title: Deploy guide
tags: [ops, Deploy, ops]
---
# Ignored heading

Run the release pipeline.
`;
  const page = parsePageMarkdown("deploy-guide", markdown);
  assert.equal(page.title, "Deploy guide");
  assert.deepEqual(page.tags, ["deploy", "ops"]);
  assert.equal(page.body.startsWith("---"), false);
  assert.match(page.body, /Run the release pipeline/);

  const commaTags = parseFrontMatter(`---
title: Ops
tags: ops, deploy, OPS
---
body
`);
  assert.deepEqual(resolveTags(commaTags.attributes), ["deploy", "ops"]);
  assert.equal(resolveTitle("slug-only", {}, "No heading here\n"), "slug-only");
  assert.equal(resolveTitle("fallback", {}, "# From heading\n"), "From heading");
});

test("index sync picks up pages added, changed, or removed while stopped", async () => {
  const workspace = makeWorkspace();
  const first = createApp({
    pagesDir: workspace.pagesDir,
    indexPath: workspace.indexPath,
  });
  const firstServer = await startServer(first);
  assert.deepEqual(
    (await (await fetch(`${firstServer.baseUrl}/search?q=Start`)).json()).results.map(
      (result) => result.slug,
    ),
    ["welcome"],
  );
  await firstServer.close();

  rmSync(join(workspace.pagesDir, "welcome.md"));
  writeFileSync(
    join(workspace.pagesDir, "runbook.md"),
    "---\ntitle: Runbook\ntags: [ops]\n---\n# Runbook\n\nCanary checks.\n",
  );
  writeFileSync(
    join(workspace.pagesDir, "extra.md"),
    "# Extra\n\nNothing matching.\n",
  );

  const second = createApp({
    pagesDir: workspace.pagesDir,
    indexPath: workspace.indexPath,
  });
  const secondServer = await startServer(second);
  try {
    const listed = await (await fetch(`${secondServer.baseUrl}/pages`)).json();
    assert.deepEqual(
      listed.map((page) => page.slug).sort(),
      ["extra", "runbook"],
    );
    const canary = await (await fetch(`${secondServer.baseUrl}/search?q=canary`)).json();
    assert.deepEqual(
      canary.results.map((result) => result.slug),
      ["runbook"],
    );
    const missing = await (await fetch(`${secondServer.baseUrl}/search?q=Start`)).json();
    assert.deepEqual(missing.results, []);
    assert.deepEqual(await (await fetch(`${secondServer.baseUrl}/tags`)).json(), [
      { tag: "ops", count: 1 },
    ]);
  } finally {
    await secondServer.close();
  }
});

test("search ranks title matches above body matches and wraps snippets", async () => {
  const workspace = makeWorkspace();
  const { app } = createTestApp(workspace);
  const server = await startServer(app);
  try {
    await putPage(
      server.baseUrl,
      "title-hit",
      "# canary dashboard\n\nUnrelated prose about shipping.\n",
    );
    await putPage(
      server.baseUrl,
      "body-hit",
      "# Other page\n\nWatch the canary dashboard for errors.\n",
    );

    const blank = await fetch(`${server.baseUrl}/search`);
    assert.equal(blank.status, 400);

    const quoted = await (await fetch(
      `${server.baseUrl}/search?q=${encodeURIComponent('canary "dashboard"!!!')}`,
    )).json();
    assert.equal(quoted.query.includes("dashboard"), true);
    assert.equal(quoted.results.length, 2);
    assert.equal(quoted.results[0].slug, "title-hit");
    assert.equal(quoted.results[1].slug, "body-hit");
    assert.ok(quoted.results[0].score > quoted.results[1].score);
    assert.match(quoted.results[1].snippet, /\*\*canary\*\*/i);

    const andQuery = await (await fetch(
      `${server.baseUrl}/search?q=${encodeURIComponent("canary missingterm")}`,
    )).json();
    assert.deepEqual(andQuery.results, []);
  } finally {
    await server.close();
  }
});

test("tags endpoints aggregate counts and list pages case-insensitively", async () => {
  const workspace = makeWorkspace();
  const { app } = createTestApp(workspace);
  const server = await startServer(app);
  try {
    await putPage(
      server.baseUrl,
      "deploy-guide",
      "---\ntitle: Deploy guide\ntags: ops, Deploy, ops\n---\n# Deploy\n\nShip it.\n",
    );
    await putPage(
      server.baseUrl,
      "on-call",
      "---\ntitle: On-call\ntags: [ops, people]\n---\n# On-call\n\nPage someone.\n",
    );
    await putPage(server.baseUrl, "readme", "# Readme\n\nNo tags here.\n");

    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags`)).json(), [
      { tag: "ops", count: 2 },
      { tag: "deploy", count: 1 },
      { tag: "people", count: 1 },
    ]);

    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/OPS`)).json(), [
      { slug: "deploy-guide", title: "Deploy guide" },
      { slug: "on-call", title: "On-call" },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/unknown`)).json(), []);

    const page = await (await fetch(`${server.baseUrl}/pages/deploy-guide`)).json();
    assert.deepEqual(page.tags, ["deploy", "ops"]);
    assert.equal(page.body.includes("Ship it."), true);
    assert.equal(page.body.startsWith("---"), false);
  } finally {
    await server.close();
  }
});
