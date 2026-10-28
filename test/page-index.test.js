import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { DEFAULT_INDEX_PATH } from "../src/page-index.js";
import { runMigrations, SCHEMA_VERSION_TABLE } from "../src/sqlite-migrations.js";
import { makeTempPath, startApp } from "./helpers.js";

const DEPLOY_PAGE = ["---", "title: Deploy guide", "tags: [ops, Deploy, ops]", "---", "# Deploy guide", "", "Run the release pipeline."].join("\n");
const WELCOME_PAGE = "# Welcome\n\nStart here.\n";

function makePagesDir() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), WELCOME_PAGE);
  return dir;
}

function makeIndexPath() {
  return makeTempPath("wiki-index-", "index.sqlite");
}

/** Reads index tables with a second connection, without going through the app. */
function readIndex(indexPath, read) {
  const database = new DatabaseSync(indexPath);
  try {
    return read(database);
  } finally {
    database.close();
  }
}

function readIndexedSlugs(indexPath) {
  return readIndex(indexPath, (database) => database.prepare("SELECT slug FROM pages ORDER BY slug").all().map((row) => row.slug));
}

function readIndexedTags(indexPath, slug) {
  return readIndex(indexPath, (database) =>
    database.prepare("SELECT tag FROM page_tags WHERE slug = ? ORDER BY tag").all(slug).map((row) => row.tag));
}

function readIndexedTitles(indexPath) {
  return readIndex(indexPath, (database) =>
    Object.fromEntries(database.prepare("SELECT slug, title FROM pages").all().map((row) => [row.slug, row.title])));
}

function readSearchSlugs(indexPath) {
  return readIndex(indexPath, (database) => database.prepare("SELECT slug FROM pages_fts ORDER BY slug").all().map((row) => row.slug));
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("migrations record their versions once in the schema version table", () => {
  const indexPath = makeIndexPath();
  const database = new DatabaseSync(indexPath);
  try {
    const applied = [];
    const migrations = [{ version: 1, apply: () => applied.push(1) }, { version: 2, apply: () => applied.push(2) }];
    runMigrations(database, migrations);
    runMigrations(database, migrations);
    const versions = database.prepare(`SELECT version FROM ${SCHEMA_VERSION_TABLE} ORDER BY version`).all().map((row) => row.version);
    assert.deepEqual(versions, [1, 2]);
    assert.deepEqual(applied, [1, 2]);
  } finally {
    database.close();
  }
});

test("a failing migration is rolled back and leaves no version row", () => {
  const indexPath = makeIndexPath();
  const database = new DatabaseSync(indexPath);
  try {
    const failingMigration = {
      version: 1,
      apply: (target) => {
        target.exec("CREATE TABLE broken (id INTEGER)");
        throw new Error("migration failed");
      },
    };
    assert.throws(() => runMigrations(database, [failingMigration]), /migration failed/);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'broken'").all();
    assert.deepEqual(tables, []);
    assert.deepEqual(database.prepare(`SELECT version FROM ${SCHEMA_VERSION_TABLE}`).all(), []);
  } finally {
    database.close();
  }
});

test("createApp indexes every page in the directory on startup", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "deploy-guide.md"), `${DEPLOY_PAGE}\n`);
  const indexPath = makeIndexPath();
  const server = await startApp({ pagesDir, indexPath });
  try {
    assert.deepEqual(readIndexedSlugs(indexPath), ["deploy-guide", "welcome"]);
    assert.deepEqual(readSearchSlugs(indexPath), ["deploy-guide", "welcome"]);
    assert.deepEqual(readIndexedTags(indexPath, "deploy-guide"), ["deploy", "ops"]);
    assert.deepEqual(readIndexedTitles(indexPath), { "deploy-guide": "Deploy guide", welcome: "Welcome" });
  } finally {
    await server.close();
  }
});

test("startup sync indexes a page added while the app was down", async () => {
  const pagesDir = makePagesDir();
  const indexPath = makeIndexPath();

  const firstRun = await startApp({ pagesDir, indexPath });
  await firstRun.close();
  writeFileSync(join(pagesDir, "added-later.md"), "# Added later\n");

  const secondRun = await startApp({ pagesDir, indexPath });
  try {
    assert.deepEqual(readIndexedSlugs(indexPath), ["added-later", "welcome"]);
    assert.equal(readIndexedTitles(indexPath)["added-later"], "Added later");
  } finally {
    await secondRun.close();
  }
});

test("startup sync re-indexes a page edited while the app was down", async () => {
  const pagesDir = makePagesDir();
  const indexPath = makeIndexPath();

  const firstRun = await startApp({ pagesDir, indexPath });
  await firstRun.close();
  writeFileSync(join(pagesDir, "welcome.md"), "---\ntags: intro\n---\n# Welcome v2\n\nEdited on disk.\n");

  const secondRun = await startApp({ pagesDir, indexPath });
  try {
    assert.equal(readIndexedTitles(indexPath).welcome, "Welcome v2");
    assert.deepEqual(readIndexedTags(indexPath, "welcome"), ["intro"]);
  } finally {
    await secondRun.close();
  }
});

test("a page removed from disk is dropped from the index on the next startup", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "on-call.md"), "# On-call handbook\n");
  const indexPath = makeIndexPath();

  const firstRun = await startApp({ pagesDir, indexPath });
  await firstRun.close();
  rmSync(join(pagesDir, "on-call.md"));

  const secondRun = await startApp({ pagesDir, indexPath });
  try {
    assert.deepEqual(readIndexedSlugs(indexPath), ["welcome"]);
    assert.deepEqual(readSearchSlugs(indexPath), ["welcome"]);
  } finally {
    await secondRun.close();
  }
});

test("PUT updates the index before responding", async () => {
  const pagesDir = makePagesDir();
  const indexPath = makeIndexPath();
  const server = await startApp({ pagesDir, indexPath });
  try {
    assert.equal((await putPage(server.baseUrl, "runbook", "---\ntags: Ops, runbook\n---\n# Runbook\n\nSteps.\n")).status, 201);
    assert.deepEqual(readIndexedSlugs(indexPath), ["runbook", "welcome"]);
    assert.deepEqual(readIndexedTags(indexPath, "runbook"), ["ops", "runbook"]);
    assert.equal(readIndexedTitles(indexPath).runbook, "Runbook");

    assert.equal((await putPage(server.baseUrl, "runbook", "# Runbook v2\n\nBetter steps.\n")).status, 200);
    assert.deepEqual(readIndexedTags(indexPath, "runbook"), []);
    assert.equal(readIndexedTitles(indexPath).runbook, "Runbook v2");
    assert.deepEqual(readSearchSlugs(indexPath), ["runbook", "welcome"]);
  } finally {
    await server.close();
  }
});

test("DELETE removes the page from the index before responding", async () => {
  const pagesDir = makePagesDir();
  writeFileSync(join(pagesDir, "deploy-guide.md"), `${DEPLOY_PAGE}\n`);
  const indexPath = makeIndexPath();
  const server = await startApp({ pagesDir, indexPath });
  try {
    assert.equal((await fetch(`${server.baseUrl}/pages/deploy-guide`, { method: "DELETE" })).status, 204);
    assert.deepEqual(readIndexedSlugs(indexPath), ["welcome"]);
    assert.deepEqual(readSearchSlugs(indexPath), ["welcome"]);
    assert.deepEqual(readIndexedTags(indexPath, "deploy-guide"), []);
  } finally {
    await server.close();
  }
});

test("restarting over an unchanged directory keeps one index row per page", async () => {
  const pagesDir = makePagesDir();
  const indexPath = makeIndexPath();

  const firstRun = await startApp({ pagesDir, indexPath });
  await firstRun.close();
  const secondRun = await startApp({ pagesDir, indexPath });
  try {
    const counts = readIndex(indexPath, (database) => ({
      pages: database.prepare("SELECT count(*) AS total FROM pages").get().total,
      searchRows: database.prepare("SELECT count(*) AS total FROM pages_fts").get().total,
    }));
    assert.deepEqual(counts, { pages: 1, searchRows: 1 });
  } finally {
    await secondRun.close();
  }
});

test("the index path can be overridden through WIKI_INDEX_PATH", async () => {
  const pagesDir = makePagesDir();
  const indexPath = makeIndexPath();
  const previousIndexPath = process.env.WIKI_INDEX_PATH;
  process.env.WIKI_INDEX_PATH = indexPath;
  let app;
  try {
    app = createApp({ pagesDir });
    assert.ok(existsSync(indexPath), "index file should be created at WIKI_INDEX_PATH");
    assert.deepEqual(readIndexedSlugs(indexPath), ["welcome"]);
  } finally {
    app?.locals.close();
    if (previousIndexPath === undefined) delete process.env.WIKI_INDEX_PATH;
    else process.env.WIKI_INDEX_PATH = previousIndexPath;
  }
});

test("WIKI_INDEX_PATH defaults to wiki-index.sqlite", () => {
  assert.equal(DEFAULT_INDEX_PATH, "wiki-index.sqlite");
});
