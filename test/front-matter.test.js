import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTag, normalizeTags, parsePage, splitFrontMatter } from "../src/front-matter.js";

test("front matter supplies title and normalized tags", () => {
  const source = ["---", "title: Deploy guide", "tags: [ops, Deploy, ops]", "---", "# Heading", "", "Body."].join("\n");
  assert.deepEqual(parsePage(source, "deploy-guide"), {
    title: "Deploy guide",
    tags: ["deploy", "ops"],
    body: "# Heading\n\nBody.",
  });
});

test("title falls back to the first level-one heading", () => {
  const page = parsePage("# On-call handbook\n\nPage the secondary.\n", "on-call");
  assert.equal(page.title, "On-call handbook");
});

test("title falls back to the slug when there is no heading", () => {
  const page = parsePage("Just text, no heading, no front matter.\n", "scratch-notes");
  assert.equal(page.title, "scratch-notes");
});

test("front-matter title wins over the heading", () => {
  const page = parsePage("---\ntitle: Front title\n---\n# Heading title\n", "slug-title");
  assert.equal(page.title, "Front title");
});

test("tags accept the comma-separated form", () => {
  const page = parsePage("---\ntags: ops, Deploy\n---\nbody\n", "comma-tags");
  assert.deepEqual(page.tags, ["deploy", "ops"]);
});

test("tags are trimmed, lowercased, de-duplicated, and sorted", () => {
  assert.deepEqual(normalizeTags("[  Ops , deploy,OPS, , docs ]"), ["deploy", "docs", "ops"]);
});

test("a single tag is normalized the same way as tags inside a page", () => {
  assert.equal(normalizeTag("  Ops "), "ops");
  assert.equal(normalizeTag("Deploy"), "deploy");
  assert.equal(normalizeTag("   "), "");
  assert.equal(normalizeTag(undefined), "");
});

test("a page without front matter has no tags and an untouched body", () => {
  const source = "# Welcome\n\nStart here.\n";
  assert.deepEqual(parsePage(source, "welcome"), { title: "Welcome", tags: [], body: source });
});

test("an empty tag list yields no tags", () => {
  const page = parsePage("---\ntags: []\n---\n# T\n", "empty-tags");
  assert.deepEqual(page.tags, []);
});

test("an unterminated front-matter block stays in the body", () => {
  const source = "---\ntitle: Never closed\n# Heading\n";
  assert.deepEqual(splitFrontMatter(source), { attributes: new Map(), body: source });
  assert.equal(parsePage(source, "unclosed").title, "Heading");
});

test("front matter without known keys leaves title and tags empty", () => {
  const page = parsePage("---\ndraft: true\n---\nplain body\n", "unknown-keys");
  assert.deepEqual(page, { title: "unknown-keys", tags: [], body: "plain body\n" });
});
