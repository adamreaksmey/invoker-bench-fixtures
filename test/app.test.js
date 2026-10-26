import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { parsePageContent, normalizeTags } from "../src/pages.js";
import { openWikiIndex, getIndexedPage, listIndexedSlugs, getSchemaVersion } from "../src/wiki-index.js";
import { startServer, makeIndexPath } from "./helpers.js";

function makePagesDir() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), "# Welcome\n\nStart here.\n");
  return dir;
}

function makeApp(pagesDir = makePagesDir()) {
  return createApp({ pagesDir, indexPath: makeIndexPath() });
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("lists, reads, creates, updates, and deletes pages", async () => {
  const server = await startServer(makeApp());
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

test("search finds pages containing the query (case-insensitive)", async () => {
  const server = await startServer(makeApp());
  try {
    const response = await (await fetch(`${server.baseUrl}/search?q=start`)).json();
    assert.equal(response.query, "start");
    assert.deepEqual(response.results.map((result) => result.slug), ["welcome"]);
    assert.equal(typeof response.results[0].score, "number");
    assert.ok(response.results[0].snippet.includes("**"));
    assert.match(response.results[0].snippet, /\*\*[^*]*[Ss]tart[^*]*\*\*/);
  } finally {
    await server.close();
  }
});

test("search requires a non-blank q", async () => {
  const server = await startServer(makeApp());
  try {
    const missing = await fetch(`${server.baseUrl}/search`);
    assert.equal(missing.status, 400);
    assert.equal(typeof (await missing.json()).error, "string");

    const blank = await fetch(`${server.baseUrl}/search?q=${encodeURIComponent("   ")}`);
    assert.equal(blank.status, 400);
    assert.equal(typeof (await blank.json()).error, "string");
  } finally {
    await server.close();
  }
});

test("search ANDs terms, ranks title matches above body, and caps at 20", async () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(pagesDir, "title-hit.md"), "# UniqueAlpha\n\nUnrelated body text.\n");
  writeFileSync(join(pagesDir, "body-hit.md"), "# Other page\n\nMentions UniqueAlpha in the body only.\n");
  writeFileSync(join(pagesDir, "both-terms.md"), "# Guide\n\nUniqueAlpha UniqueBeta together.\n");
  writeFileSync(join(pagesDir, "one-term.md"), "# Partial\n\nOnly UniqueAlpha here.\n");
  for (let index = 0; index < 25; index += 1) {
    writeFileSync(
      join(pagesDir, `filler-${String(index).padStart(2, "0")}.md`),
      `# Filler ${index}\n\nSharedNeedle content ${index}.\n`,
    );
  }

  const server = await startServer(makeApp(pagesDir));
  try {
    const andResponse = await (await fetch(
      `${server.baseUrl}/search?q=${encodeURIComponent("UniqueAlpha UniqueBeta")}`,
    )).json();
    assert.deepEqual(andResponse.results.map((result) => result.slug), ["both-terms"]);

    const ranked = await (await fetch(
      `${server.baseUrl}/search?q=${encodeURIComponent("UniqueAlpha")}`,
    )).json();
    assert.ok(ranked.results.length >= 2);
    assert.equal(ranked.results[0].slug, "title-hit");
    assert.ok(ranked.results[0].score > ranked.results[1].score);

    const limited = await (await fetch(
      `${server.baseUrl}/search?q=${encodeURIComponent("SharedNeedle")}`,
    )).json();
    assert.equal(limited.results.length, 20);
    for (let index = 1; index < limited.results.length; index += 1) {
      assert.ok(limited.results[index - 1].score >= limited.results[index].score);
    }
  } finally {
    await server.close();
  }
});

test("search treats punctuation and quotes as plain text and never 500s", async () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(pagesDir, "punct.md"), "# Punct\n\nHello world and C++ notes.\n");
  const server = await startServer(makeApp(pagesDir));
  try {
    const quoted = await fetch(`${server.baseUrl}/search?q=${encodeURIComponent('"Hello"')}`);
    assert.equal(quoted.status, 200);
    const quotedBody = await quoted.json();
    assert.deepEqual(quotedBody.results.map((result) => result.slug), ["punct"]);

    const operators = await fetch(
      `${server.baseUrl}/search?q=${encodeURIComponent('Hello AND OR NOT * ( ) ^ : "world"')}`,
    );
    assert.equal(operators.status, 200);
    assert.equal(Array.isArray((await operators.json()).results), true);

    const plusPlus = await fetch(`${server.baseUrl}/search?q=${encodeURIComponent("C++")}`);
    assert.equal(plusPlus.status, 200);
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
  const server = await startServer(makeApp(pagesDir));
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
  const server = await startServer(makeApp());
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

test("createApp runs migrations and indexes existing pages on startup", async () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  const indexPath = makeIndexPath();
  writeFileSync(
    join(pagesDir, "alpha.md"),
    "---\ntitle: Alpha\ntags: [one, Two]\n---\nAlpha body.\n",
  );
  writeFileSync(join(pagesDir, "beta.md"), "# Beta\n\nBeta body.\n");

  const app = createApp({ pagesDir, indexPath });
  try {
    assert.equal(app.locals.wikiIndex.schemaVersion(), 1);
    assert.deepEqual(app.locals.wikiIndex.listSlugs(), ["alpha", "beta"]);
    assert.deepEqual(app.locals.wikiIndex.getPage("alpha"), {
      slug: "alpha",
      title: "Alpha",
      body: "Alpha body.\n",
      tags: ["one", "two"],
      mtimeMs: app.locals.wikiIndex.getPage("alpha").mtimeMs,
    });
    assert.deepEqual(app.locals.wikiIndex.getPage("beta").tags, []);
    assert.equal(app.locals.wikiIndex.getPage("beta").title, "Beta");
  } finally {
    app.locals.close();
  }
});

test("startup sync reflects added, changed, and removed pages", async () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  const indexPath = makeIndexPath();
  writeFileSync(join(pagesDir, "keep.md"), "# Keep\n\nOriginal.\n");
  writeFileSync(join(pagesDir, "gone.md"), "# Gone\n\nRemove me.\n");

  const first = createApp({ pagesDir, indexPath });
  assert.deepEqual(first.locals.wikiIndex.listSlugs(), ["gone", "keep"]);
  first.locals.close();

  writeFileSync(join(pagesDir, "keep.md"), "# Keep\n\nChanged body.\n");
  writeFileSync(join(pagesDir, "new.md"), "# New\n\nFresh.\n");
  rmSync(join(pagesDir, "gone.md"));

  const second = createApp({ pagesDir, indexPath });
  try {
    assert.deepEqual(second.locals.wikiIndex.listSlugs(), ["keep", "new"]);
    assert.equal(second.locals.wikiIndex.getPage("keep").body, "# Keep\n\nChanged body.\n");
    assert.equal(second.locals.wikiIndex.getPage("new").title, "New");
    assert.equal(second.locals.wikiIndex.getPage("gone"), undefined);
  } finally {
    second.locals.close();
  }
});

test("PUT and DELETE update the index before responding", async () => {
  const pagesDir = makePagesDir();
  const indexPath = makeIndexPath();
  const app = createApp({ pagesDir, indexPath });
  const server = await startServer(app);
  try {
    const created = await putPage(
      server.baseUrl,
      "ops",
      "---\ntitle: Ops\ntags: [prod]\n---\nRunbook.\n",
    );
    assert.equal(created.status, 201);
    assert.deepEqual(app.locals.wikiIndex.getPage("ops"), {
      slug: "ops",
      title: "Ops",
      body: "Runbook.\n",
      tags: ["prod"],
      mtimeMs: app.locals.wikiIndex.getPage("ops").mtimeMs,
    });

    assert.equal((await putPage(server.baseUrl, "ops", "# Ops\n\nUpdated.\n")).status, 200);
    assert.equal(app.locals.wikiIndex.getPage("ops").title, "Ops");
    assert.equal(app.locals.wikiIndex.getPage("ops").body, "# Ops\n\nUpdated.\n");
    assert.deepEqual(app.locals.wikiIndex.getPage("ops").tags, []);

    assert.equal((await fetch(`${server.baseUrl}/pages/ops`, { method: "DELETE" })).status, 204);
    assert.equal(app.locals.wikiIndex.getPage("ops"), undefined);
    assert.ok(!app.locals.wikiIndex.listSlugs().includes("ops"));
  } finally {
    await server.close();
  }
});

test("schema version table and FTS5 content are persisted", () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  const indexPath = makeIndexPath();
  writeFileSync(join(pagesDir, "fts.md"), "# FTS Title\n\nUniqueNeedle in body.\n");
  const app = createApp({ pagesDir, indexPath });
  app.locals.close();

  const db = openWikiIndex(indexPath);
  try {
    assert.equal(getSchemaVersion(db), 1);
    assert.deepEqual(listIndexedSlugs(db), ["fts"]);
    const indexed = getIndexedPage(db, "fts");
    assert.equal(indexed.title, "FTS Title");
    const ftsHits = db
      .prepare("SELECT slug FROM pages_fts WHERE pages_fts MATCH ?")
      .all("UniqueNeedle");
    assert.deepEqual(ftsHits.map((row) => row.slug), ["fts"]);
  } finally {
    db.close();
  }
});

test("GET /tags returns tag counts sorted by count desc then tag asc", async () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(
    join(pagesDir, "alpha.md"),
    "---\ntitle: Alpha\ntags: [ops, deploy]\n---\nAlpha.\n",
  );
  writeFileSync(
    join(pagesDir, "beta.md"),
    "---\ntitle: Beta\ntags: [ops, wiki]\n---\nBeta.\n",
  );
  writeFileSync(
    join(pagesDir, "gamma.md"),
    "---\ntitle: Gamma\ntags: [ops]\n---\nGamma.\n",
  );
  writeFileSync(join(pagesDir, "plain.md"), "# Plain\n\nNo tags.\n");

  const server = await startServer(makeApp(pagesDir));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags`)).json(), [
      { tag: "ops", count: 3 },
      { tag: "deploy", count: 1 },
      { tag: "wiki", count: 1 },
    ]);
  } finally {
    await server.close();
  }
});

test("GET /tags/:tag lists pages by slug; case-insensitive; unknown tag is []", async () => {
  const pagesDir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(
    join(pagesDir, "zebra.md"),
    "---\ntitle: Zebra\ntags: [ops]\n---\nZ.\n",
  );
  writeFileSync(
    join(pagesDir, "alpha.md"),
    "---\ntitle: Alpha\ntags: [Ops, deploy]\n---\nA.\n",
  );
  writeFileSync(
    join(pagesDir, "middle.md"),
    "---\ntitle: Middle\ntags: [deploy]\n---\nM.\n",
  );

  const server = await startServer(makeApp(pagesDir));
  try {
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/ops`)).json(), [
      { slug: "alpha", title: "Alpha" },
      { slug: "zebra", title: "Zebra" },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/OPS`)).json(), [
      { slug: "alpha", title: "Alpha" },
      { slug: "zebra", title: "Zebra" },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/deploy`)).json(), [
      { slug: "alpha", title: "Alpha" },
      { slug: "middle", title: "Middle" },
    ]);
    assert.deepEqual(await (await fetch(`${server.baseUrl}/tags/missing`)).json(), []);
  } finally {
    await server.close();
  }
});
