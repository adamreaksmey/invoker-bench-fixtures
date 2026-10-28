import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTempPath, startApp } from "./helpers.js";

const OPS_TAGGED_PAGES = {
  "deploy-guide": ["---", "title: Deploy guide", "tags: [ops, Deploy]", "---", "# Deploy guide", ""].join("\n"),
  "on-call": ["---", "title: On-call handbook", "tags: ops, infra", "---", "# On-call handbook", ""].join("\n"),
  "release-notes": ["---", "title: Release notes", "tags: [Ops]", "---", "# Release notes", ""].join("\n"),
  welcome: "# Welcome\n\nStart here.\n",
};

function makePagesDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  for (const [slug, source] of Object.entries(files)) writeFileSync(join(dir, `${slug}.md`), source);
  return dir;
}

function startAppFor(files) {
  return startApp({ pagesDir: makePagesDir(files), indexPath: makeTempPath("wiki-index-", "index.sqlite") });
}

function getJson(baseUrl, path) {
  return fetch(`${baseUrl}${path}`).then((response) => response.json());
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("GET /tags returns each tag with its page count, most used first then alphabetical", async () => {
  const server = await startAppFor(OPS_TAGGED_PAGES);
  try {
    assert.deepEqual(await getJson(server.baseUrl, "/tags"), [
      { tag: "ops", count: 3 },
      { tag: "deploy", count: 1 },
      { tag: "infra", count: 1 },
    ]);
  } finally {
    await server.close();
  }
});

test("GET /tags is empty when no page has tags", async () => {
  const server = await startAppFor({ welcome: "# Welcome\n" });
  try {
    assert.deepEqual(await getJson(server.baseUrl, "/tags"), []);
  } finally {
    await server.close();
  }
});

test("GET /tags/:tag returns slug and title sorted by slug", async () => {
  const server = await startAppFor(OPS_TAGGED_PAGES);
  try {
    assert.deepEqual(await getJson(server.baseUrl, "/tags/ops"), [
      { slug: "deploy-guide", title: "Deploy guide" },
      { slug: "on-call", title: "On-call handbook" },
      { slug: "release-notes", title: "Release notes" },
    ]);
  } finally {
    await server.close();
  }
});

test("GET /tags/:tag matches the tag case-insensitively", async () => {
  const server = await startAppFor(OPS_TAGGED_PAGES);
  try {
    const expected = [{ slug: "on-call", title: "On-call handbook" }];
    assert.deepEqual(await getJson(server.baseUrl, "/tags/INFRA"), expected);
    assert.deepEqual(await getJson(server.baseUrl, "/tags/Infra"), expected);
  } finally {
    await server.close();
  }
});

test("GET /tags/:tag returns an empty list for an unknown tag", async () => {
  const server = await startAppFor(OPS_TAGGED_PAGES);
  try {
    assert.deepEqual(await getJson(server.baseUrl, "/tags/nonexistent"), []);
    assert.deepEqual(await getJson(server.baseUrl, "/tags/%20"), []);
  } finally {
    await server.close();
  }
});

test("tag endpoints read the index, so PUT and DELETE are reflected immediately", async () => {
  const server = await startAppFor({ welcome: "# Welcome\n" });
  try {
    assert.deepEqual(await getJson(server.baseUrl, "/tags"), []);

    assert.equal((await putPage(server.baseUrl, "runbook", "---\ntags: [Ops, Runbook]\n---\n# Runbook\n\nSteps.\n")).status, 201);
    assert.deepEqual(await getJson(server.baseUrl, "/tags"), [
      { tag: "ops", count: 1 },
      { tag: "runbook", count: 1 },
    ]);
    assert.deepEqual(await getJson(server.baseUrl, "/tags/ops"), [{ slug: "runbook", title: "Runbook" }]);

    assert.equal((await putPage(server.baseUrl, "runbook", "# Runbook v2\n\nNo tags now.\n")).status, 200);
    assert.deepEqual(await getJson(server.baseUrl, "/tags"), []);

    assert.equal((await putPage(server.baseUrl, "runbook", "---\ntags: ops\n---\n# Runbook\n")).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/pages/runbook`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await getJson(server.baseUrl, "/tags"), []);
    assert.deepEqual(await getJson(server.baseUrl, "/tags/ops"), []);
  } finally {
    await server.close();
  }
});

test("tags added on disk while the app is down appear after restart", async () => {
  const pagesDir = makePagesDir({ welcome: "# Welcome\n" });
  const indexPath = makeTempPath("wiki-index-", "index.sqlite");

  const firstRun = await startApp({ pagesDir, indexPath });
  await firstRun.close();
  writeFileSync(join(pagesDir, "welcome.md"), "---\ntags: intro\n---\n# Welcome\n");

  const secondRun = await startApp({ pagesDir, indexPath });
  try {
    assert.deepEqual(await getJson(secondRun.baseUrl, "/tags"), [{ tag: "intro", count: 1 }]);
    assert.deepEqual(await getJson(secondRun.baseUrl, "/tags/intro"), [{ slug: "welcome", title: "Welcome" }]);
  } finally {
    await secondRun.close();
  }
});
