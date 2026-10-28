import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  deletePageFromIndex,
  findPagesByTag,
  listTags,
  migrateIndex,
  openIndex,
  searchPages,
  syncIndex,
  upsertPageInIndex,
} from "../src/index.js";
import { parsePage } from "../src/pages.js";

function makePagesDir() {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  writeFileSync(join(dir, "welcome.md"), "# Welcome\n\nStart here.\n");
  return dir;
}

function inMemoryDb() {
  const db = new DatabaseSync(":memory:");
  migrateIndex(db);
  return db;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("migrateIndex creates schema version table and page tables", () => {
  const db = new DatabaseSync(":memory:");
  migrateIndex(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(tables, ["page_tags", "pages", "pages_fts", "pages_fts_config", "pages_fts_content", "pages_fts_data", "pages_fts_docsize", "pages_fts_idx", "schema_version", "tags"]);
  const version = db.prepare("SELECT version FROM schema_version").get();
  assert.equal(version.version, 1);
});

test("openIndex migrates a fresh database", () => {
  const db = openIndex(":memory:");
  try {
    const version = db.prepare("SELECT version FROM schema_version").get();
    assert.equal(version.version, 1);
  } finally {
    db.close();
  }
});

test("upsertPageInIndex inserts page, fts row, and tags", () => {
  const db = inMemoryDb();
  try {
    const page = parsePage("guide", "---\ntitle: Deploy guide\ntags: [ops, deploy]\n---\n# Deploy guide\n\nRun the pipeline.\n");
    upsertPageInIndex(db, page, 1234);

    const indexed = plain(db.prepare("SELECT slug, modified_at FROM pages").get());
    assert.deepEqual(indexed, { slug: "guide", modified_at: 1234 });

    const fts = db.prepare("SELECT slug, title, body FROM pages_fts").all().map(plain);
    assert.deepEqual(fts, [{ slug: "guide", title: "Deploy guide", body: "# Deploy guide\n\nRun the pipeline.\n" }]);

    const tags = db.prepare("SELECT tag FROM tags ORDER BY tag").all().map((row) => row.tag);
    assert.deepEqual(tags, ["deploy", "ops"]);

    const pageTags = db.prepare("SELECT slug, tag FROM page_tags ORDER BY tag").all().map(plain);
    assert.deepEqual(pageTags, [{ slug: "guide", tag: "deploy" }, { slug: "guide", tag: "ops" }]);
  } finally {
    db.close();
  }
});

test("upsertPageInIndex updates existing page and replaces tags", () => {
  const db = inMemoryDb();
  try {
    const original = parsePage("guide", "---\ntags: [a]\n---\n# Guide\n\nBody.\n");
    upsertPageInIndex(db, original, 1);
    const updated = parsePage("guide", "---\ntags: [b]\n---\n# Updated guide\n\nNew body.\n");
    upsertPageInIndex(db, updated, 2);

    const indexed = plain(db.prepare("SELECT modified_at FROM pages WHERE slug = ?").get("guide"));
    assert.deepEqual(indexed, { modified_at: 2 });

    const fts = plain(db.prepare("SELECT title, body FROM pages_fts WHERE slug = ?").get("guide"));
    assert.deepEqual(fts, { title: "Updated guide", body: "# Updated guide\n\nNew body.\n" });

    const pageTags = db.prepare("SELECT tag FROM page_tags WHERE slug = ?").all("guide").map((row) => row.tag);
    assert.deepEqual(pageTags, ["b"]);

    const tags = db.prepare("SELECT tag FROM tags ORDER BY tag").all().map((row) => row.tag);
    assert.ok(tags.includes("b"));
  } finally {
    db.close();
  }
});

test("deletePageFromIndex removes page, fts row, and tag associations", () => {
  const db = inMemoryDb();
  try {
    const page = parsePage("guide", "---\ntags: [ops]\n---\n# Guide\n");
    upsertPageInIndex(db, page, 1);
    deletePageFromIndex(db, "guide");

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pages").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM page_tags").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pages_fts").get().count, 0);
  } finally {
    db.close();
  }
});

test("syncIndex adds pages from directory", () => {
  const pagesDir = makePagesDir();
  const db = inMemoryDb();
  try {
    syncIndex(db, pagesDir);
    const slugs = db.prepare("SELECT slug FROM pages ORDER BY slug").all().map((row) => row.slug);
    assert.deepEqual(slugs, ["welcome"]);
  } finally {
    db.close();
  }
});

test("syncIndex removes pages deleted from directory", () => {
  const pagesDir = makePagesDir();
  const db = inMemoryDb();
  try {
    syncIndex(db, pagesDir);
    rmSync(join(pagesDir, "welcome.md"));
    syncIndex(db, pagesDir);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pages").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pages_fts").get().count, 0);
  } finally {
    db.close();
  }
});

test("syncIndex updates pages changed while app was down", () => {
  const pagesDir = makePagesDir();
  const db = inMemoryDb();
  try {
    writeFileSync(join(pagesDir, "guide.md"), "# Guide\n\nOriginal.\n");
    syncIndex(db, pagesDir);
    writeFileSync(join(pagesDir, "guide.md"), "# Updated guide\n\nChanged.\n");
    syncIndex(db, pagesDir);
    const page = plain(db.prepare("SELECT title, body FROM pages_fts WHERE slug = ?").get("guide"));
    assert.deepEqual(page, { title: "Updated guide", body: "# Updated guide\n\nChanged.\n" });
  } finally {
    db.close();
  }
});

test("searchPages ranks title matches above body matches", () => {
  const db = inMemoryDb();
  try {
    upsertPageInIndex(db, parsePage("body-only", "# Other\n\nFind me here.\n"), 1);
    upsertPageInIndex(db, parsePage("title-only", "# Find me\n\nOther body.\n"), 1);
    upsertPageInIndex(db, parsePage("both", "# Find me\n\nFind me here too.\n"), 1);

    const { results } = searchPages(db, "Find me");
    assert.deepEqual(results.map((result) => result.slug), ["title-only", "both", "body-only"]);
    assert.ok(results[0].score > results[1].score);
    assert.ok(results[1].score > results[2].score);
  } finally {
    db.close();
  }
});

test("searchPages limits results and returns snippets", () => {
  const db = inMemoryDb();
  try {
    for (let index = 0; index < 25; index += 1) {
      upsertPageInIndex(db, parsePage(`page-${index}`, `# Page ${index}\n\nCommon term here.\n`), 1);
    }
    const { results } = searchPages(db, "Common term");
    assert.equal(results.length, 20);
    assert.ok(results[0].snippet.includes("**Common**"));
  } finally {
    db.close();
  }
});

test("searchPages is case-insensitive", () => {
  const db = inMemoryDb();
  try {
    upsertPageInIndex(db, parsePage("guide", "# Hello World\n\nBody text.\n"), 1);
    const lower = searchPages(db, "hello world");
    const upper = searchPages(db, "HELLO WORLD");
    assert.deepEqual(lower.results.map((result) => result.slug), ["guide"]);
    assert.deepEqual(upper.results.map((result) => result.slug), ["guide"]);
  } finally {
    db.close();
  }
});

test("searchPages requires all terms to match", () => {
  const db = inMemoryDb();
  try {
    upsertPageInIndex(db, parsePage("a", "# Alpha\n\nApple banana.\n"), 1);
    upsertPageInIndex(db, parsePage("b", "# Beta\n\nApple cherry.\n"), 1);
    const { results } = searchPages(db, "apple banana");
    assert.deepEqual(results.map((result) => result.slug), ["a"]);
  } finally {
    db.close();
  }
});

test("searchPages treats punctuation and quotes as plain text", () => {
  const db = inMemoryDb();
  try {
    upsertPageInIndex(db, parsePage("punctuation", "# Punctuation\n\nHello \"world\" and can't stop.\n"), 1);
    for (const query of ['"hello', "can't", "\"world\"", "-stop", "!!!"]) {
      assert.doesNotThrow(() => searchPages(db, query), `query ${query} should not throw`);
    }
    const quoted = searchPages(db, "\"world\"");
    assert.ok(quoted.results.some((result) => result.slug === "punctuation"));
  } finally {
    db.close();
  }
});

test("searchPages returns empty results for punctuation-only queries", () => {
  const db = inMemoryDb();
  try {
    upsertPageInIndex(db, parsePage("page", "# Page\n\nContent.\n"), 1);
    for (const query of ["!", "?", "*", "-", "'", "\"", "(", ")"]) {
      assert.deepEqual(searchPages(db, query).results, [], `query ${query} should return no results`);
    }
  } finally {
    db.close();
  }
});

test("listTags returns counts sorted by count desc then tag asc", () => {
  const db = inMemoryDb();
  try {
    upsertPageInIndex(db, parsePage("a", "---\ntags: [shared, alpha]\n---\n# A\n"), 1);
    upsertPageInIndex(db, parsePage("b", "---\ntags: [shared, beta]\n---\n# B\n"), 1);
    upsertPageInIndex(db, parsePage("c", "---\ntags: [shared]\n---\n# C\n"), 1);

    assert.deepEqual(listTags(db), [
      { tag: "shared", count: 3 },
      { tag: "alpha", count: 1 },
      { tag: "beta", count: 1 },
    ]);
  } finally {
    db.close();
  }
});

test("findPagesByTag matches case-insensitively and sorts by slug", () => {
  const db = inMemoryDb();
  try {
    upsertPageInIndex(db, parsePage("z-page", "---\ntags: [OPS]\n---\n# Z\n"), 1);
    upsertPageInIndex(db, parsePage("a-page", "---\ntags: [ops]\n---\n# A\n"), 1);

    assert.deepEqual(findPagesByTag(db, "OPS"), [
      { slug: "a-page", title: "A" },
      { slug: "z-page", title: "Z" },
    ]);
    assert.deepEqual(findPagesByTag(db, "unknown"), []);
  } finally {
    db.close();
  }
});
