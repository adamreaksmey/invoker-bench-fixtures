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

test("normalizeTags returns no tags for non-string values", () => {
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags(""), []);
  assert.deepEqual(normalizeTags("[]"), []);
});

test("a page without front matter has no tags and an untouched body", () => {
  const source = "# Welcome\n\nStart here.\n";
  assert.deepEqual(parsePage(source, "welcome"), { title: "Welcome", tags: [], body: source });
});

test("an empty tag list yields no tags", () => {
  assert.deepEqual(parsePage("---\ntags: []\n---\n# T\n", "empty-tags").tags, []);
  assert.deepEqual(parsePage("---\ntags:\n---\n# T\n", "blank-tags").tags, []);
  assert.deepEqual(parsePage("---\ntags: [ , ]\n---\n# T\n", "blank-list-tags").tags, []);
});

test("a blank front-matter title falls back to the heading, then the slug", () => {
  assert.equal(parsePage("---\ntitle:\n---\n# Heading\n", "blank-title").title, "Heading");
  assert.equal(parsePage("---\ntitle:   \n---\nplain text\n", "slug-fallback").title, "slug-fallback");
});

test("front-matter lines without a key separator are ignored", () => {
  const page = parsePage("---\ntitle: Kept\nignored line\ntags: ops\n---\nbody\n", "malformed-lines");
  assert.deepEqual(page, { title: "Kept", tags: ["ops"], body: "body\n" });
});

test("front matter is only recognized at the very start of the page", () => {
  const leadingBlank = "\n---\ntitle: Not front matter\n---\n# Heading\n";
  assert.deepEqual(parsePage(leadingBlank, "leading-blank"), {
    title: "Heading",
    tags: [],
    body: leadingBlank,
  });

  const laterBlock = "Intro line\n\n---\ntitle: Later\n---\n# Heading\n";
  assert.deepEqual(parsePage(laterBlock, "later-block"), {
    title: "Heading",
    tags: [],
    body: laterBlock,
  });
});

test("front matter written with CRLF line endings is still recognized", () => {
  const source = "---\r\ntitle: Win Guide\r\ntags: [Ops, Deploy]\r\n---\r\n# Heading\r\n\r\nBody.\r\n";
  assert.deepEqual(parsePage(source, "win"), {
    title: "Win Guide",
    tags: ["deploy", "ops"],
    body: "# Heading\r\n\r\nBody.\r\n",
  });
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
