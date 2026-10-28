import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTempPath, startApp } from "./helpers.js";

const FRONT_MATTER_PAGE = ["---", "title: Deploy guide", "tags: [ops, Deploy, ops]", "---", "# Deploy guide", "", "Run the release pipeline."].join("\n");

function makePagesDir() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), "# Welcome\n\nStart here.\n");
  return dir;
}

function makePagesDirWithFrontMatter() {
  const dir = makePagesDir();
  writeFileSync(join(dir, "deploy-guide.md"), `${FRONT_MATTER_PAGE}\n`);
  writeFileSync(join(dir, "on-call.md"), "# On-call handbook\n\nPage the secondary.\n");
  return dir;
}

/** Opens an app over a fresh pages directory and a throwaway index file. */
function startAppFor(pagesDir) {
  return startApp({ pagesDir, indexPath: makeTempPath("wiki-index-", "index.sqlite") });
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const server = await startAppFor(makePagesDir());
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

test("GET /pages includes parsed tags and titles", async () => {
  const server = await startAppFor(makePagesDirWithFrontMatter());
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages`)).json(), [
      { slug: "deploy-guide", title: "Deploy guide", tags: ["deploy", "ops"] },
      { slug: "on-call", title: "On-call handbook", tags: [] },
      { slug: "welcome", title: "Welcome", tags: [] },
    ]);
  } finally {
    await server.close();
  }
});

test("GET /pages/:slug returns tags and a body without front matter", async () => {
  const server = await startAppFor(makePagesDirWithFrontMatter());
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/pages/deploy-guide`)).json(), {
      slug: "deploy-guide",
      title: "Deploy guide",
      tags: ["deploy", "ops"],
      body: "# Deploy guide\n\nRun the release pipeline.\n",
    });
  } finally {
    await server.close();
  }
});

test("PUT parses front matter from the stored file", async () => {
  const server = await startAppFor(makePagesDir());
  try {
    const created = await (await putPage(server.baseUrl, "runbook", "---\ntags: Ops, runbook\n---\n# Runbook\n\nSteps.\n")).json();
    assert.deepEqual(created, { slug: "runbook", title: "Runbook", tags: ["ops", "runbook"], body: "# Runbook\n\nSteps.\n" });
    const listed = await (await fetch(`${server.baseUrl}/pages`)).json();
    assert.deepEqual(listed.find((page) => page.slug === "runbook"), { slug: "runbook", title: "Runbook", tags: ["ops", "runbook"] });
  } finally {
    await server.close();
  }
});

test("PUT stores the full Markdown source including front matter", async () => {
  const pagesDir = makePagesDir();
  const server = await startAppFor(pagesDir);
  const source = "---\ntitle: Stored title\ntags: [ops]\n---\n# Heading\n\nBody.\n";
  try {
    assert.equal((await putPage(server.baseUrl, "stored", source)).status, 201);
    assert.equal(readFileSync(join(pagesDir, "stored.md"), "utf8"), source);
  } finally {
    await server.close();
  }
});

test("PUT rejects a missing or non-string body with 400", async () => {
  const server = await startAppFor(makePagesDir());
  try {
    for (const payload of [{}, { body: 42 }, { body: null }, { body: ["# Array"] }]) {
      const response = await fetch(`${server.baseUrl}/pages/bad-body`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(payload)}`);
      assert.equal(typeof (await response.json()).error, "string");
    }
    assert.equal((await fetch(`${server.baseUrl}/pages/bad-body`)).status, 404);
  } finally {
    await server.close();
  }
});

test("every page route rejects an invalid slug with 400", async () => {
  const server = await startAppFor(makePagesDir());
  try {
    for (const slug of ["Bad_Slug", "Upper", "with%20space", "dot.dot"]) {
      assert.equal((await fetch(`${server.baseUrl}/pages/${slug}`)).status, 400, `GET ${slug}`);
      assert.equal((await putPage(server.baseUrl, slug, "# Bad\n")).status, 400, `PUT ${slug}`);
      assert.equal((await fetch(`${server.baseUrl}/pages/${slug}`, { method: "DELETE" })).status, 400, `DELETE ${slug}`);
    }
  } finally {
    await server.close();
  }
});

test("DELETE reports 404 for a page that does not exist", async () => {
  const server = await startAppFor(makePagesDir());
  try {
    assert.equal((await fetch(`${server.baseUrl}/pages/missing`, { method: "DELETE" })).status, 404);
  } finally {
    await server.close();
  }
});

test("search finds pages containing the query ignoring case", async () => {
  const server = await startAppFor(makePagesDir());
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=Start`)).json();
    assert.deepEqual(response.results.map((result) => result.slug), ["welcome"]);
  } finally {
    await server.close();
  }
});
