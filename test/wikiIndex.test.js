import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openIndex } from "../src/wikiIndex.js";

function makeTempDir(prefix = "wiki-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeIndexPath() {
  return join(makeTempDir("wiki-index-"), "index.sqlite");
}

function writePage(dir, slug, content) {
  writeFileSync(join(dir, `${slug}.md`), content);
}

test("index sync loads pages from directory", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "welcome", "# Welcome\n\nStart here.");
  writePage(pagesDir, "deploy", "---\ntitle: Deploy guide\ntags: [ops, deploy]\n---\n# Deploy guide\n\nRun the pipeline.");
  const index = openIndex(makeIndexPath(), pagesDir);
  try {
    const pages = index.listPages();
    assert.equal(pages.length, 2);
    const deploy = pages.find((page) => page.slug === "deploy");
    assert.equal(deploy.title, "Deploy guide");
    assert.deepEqual(deploy.tags, ["deploy", "ops"]);
  } finally {
    index.close();
  }
});

test("index sync removes pages missing from directory", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "keep", "# Keep");
  const firstIndex = openIndex(makeIndexPath(), pagesDir);
  firstIndex.close();

  rmSync(join(pagesDir, "keep.md"));
  writePage(pagesDir, "new", "# New");
  const secondIndex = openIndex(makeIndexPath(), pagesDir);
  try {
    const slugs = secondIndex.listPages().map((page) => page.slug);
    assert.deepEqual(slugs, ["new"]);
  } finally {
    secondIndex.close();
  }
});

test("index sync updates changed pages", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "page", "# Old\n\ntags: [a]");
  const firstIndex = openIndex(makeIndexPath(), pagesDir);
  firstIndex.close();

  writePage(pagesDir, "page", "---\ntitle: New\ntags: [b, c]\n---\n# Ignored\n\nBody.");
  const secondIndex = openIndex(makeIndexPath(), pagesDir);
  try {
    const page = secondIndex.listPages()[0];
    assert.equal(page.title, "New");
    assert.deepEqual(page.tags, ["b", "c"]);
  } finally {
    secondIndex.close();
  }
});

test("search ranks title matches above body matches", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "a", "# deploy guide\n\nOnly body deploy guide.");
  writePage(pagesDir, "b", "# Other\n\nBody deploy guide repeated deploy guide.");
  const index = openIndex(makeIndexPath(), pagesDir);
  try {
    const results = index.search("deploy guide");
    assert.deepEqual(results.map((result) => result.slug), ["a", "b"]);
    assert.ok(results[0].score > results[1].score);
  } finally {
    index.close();
  }
});

test("search requires all terms to match", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "a", "# One two");
  writePage(pagesDir, "b", "# One three");
  const index = openIndex(makeIndexPath(), pagesDir);
  try {
    const results = index.search("one two");
    assert.deepEqual(results.map((result) => result.slug), ["a"]);
  } finally {
    index.close();
  }
});

test("search handles punctuation and quotes safely", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "a", "# Hello\n\nWorld's \"great\" place.");
  const index = openIndex(makeIndexPath(), pagesDir);
  try {
    const results = index.search('world\'s "great"');
    assert.equal(results.length, 1);
    assert.ok(results[0].snippet.includes("**"));
  } finally {
    index.close();
  }
});

test("search limits results to at most 20", () => {
  const pagesDir = makeTempDir();
  for (let index = 0; index < 25; index += 1) {
    writePage(pagesDir, `page-${index}`, `# Page ${index}\n\ncommon term`);
  }
  const index = openIndex(makeIndexPath(), pagesDir);
  try {
    const results = index.search("common term");
    assert.ok(results.length <= 20);
  } finally {
    index.close();
  }
});

test("listTags returns counts sorted by count desc then tag asc", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "a", "---\ntags: [x, y]\n---\n");
  writePage(pagesDir, "b", "---\ntags: [x, z]\n---\n");
  writePage(pagesDir, "c", "---\ntags: [x]\n---\n");
  const index = openIndex(makeIndexPath(), pagesDir);
  try {
    const tags = index.listTags();
    assert.deepEqual(tags, [
      { tag: "x", count: 3 },
      { tag: "y", count: 1 },
      { tag: "z", count: 1 },
    ]);
  } finally {
    index.close();
  }
});

test("findPagesByTag is case-insensitive and sorted by slug", () => {
  const pagesDir = makeTempDir();
  writePage(pagesDir, "b-page", "---\ntags: [OPS]\n---\n# B");
  writePage(pagesDir, "a-page", "---\ntags: [ops]\n---\n# A");
  const index = openIndex(makeIndexPath(), pagesDir);
  try {
    const pages = index.findPagesByTag("Ops");
    assert.deepEqual(pages, [
      { slug: "a-page", title: "A" },
      { slug: "b-page", title: "B" },
    ]);
    assert.equal(index.findPagesByTag("unknown").length, 0);
  } finally {
    index.close();
  }
});
