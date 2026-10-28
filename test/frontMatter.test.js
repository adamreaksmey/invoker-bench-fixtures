import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePage } from "../src/frontMatter.js";

test("parsePage extracts front-matter title and tags", () => {
  const markdown = "---\ntitle: Deploy guide\ntags: [ops, Deploy, ops]\n---\n# Heading\n\nBody text.";
  const page = parsePage("deploy", markdown);
  assert.equal(page.title, "Deploy guide");
  assert.deepEqual(page.tags, ["deploy", "ops"]);
  assert.equal(page.body, "# Heading\n\nBody text.");
  assert.equal(page.slug, "deploy");
});

test("parsePage supports comma-separated tags", () => {
  const page = parsePage("deploy", "---\ntags: ops, deploy\n---\nBody.");
  assert.deepEqual(page.tags, ["deploy", "ops"]);
});

test("parsePage trims, lowercases, deduplicates, and sorts tags", () => {
  const page = parsePage("x", "---\ntags: [  Z, a, Z, b, A ]\n---\n");
  assert.deepEqual(page.tags, ["a", "b", "z"]);
});

test("parsePage strips quotes from title and tag values", () => {
  const page = parsePage("x", '---\ntitle: "Quoted Title"\ntags: ["a", "b"]\n---\n# Heading');
  assert.equal(page.title, "Quoted Title");
  assert.deepEqual(page.tags, ["a", "b"]);
});

test("parsePage falls back to first heading when title is absent", () => {
  const page = parsePage("slug", "# Hello World\n\nText.");
  assert.equal(page.title, "Hello World");
});

test("parsePage falls back to slug when title and heading are absent", () => {
  const page = parsePage("the-slug", "Just body text.");
  assert.equal(page.title, "the-slug");
});

test("parsePage excludes front matter from body", () => {
  const page = parsePage("slug", "---\ntitle: T\n---\n# H");
  assert.equal(page.body, "# H");
});

test("parsePage treats missing closing delimiter as no front matter", () => {
  const page = parsePage("slug", "---\ntitle: T\n\n# H");
  assert.equal(page.title, "H");
  assert.ok(page.body.startsWith("---"));
});
