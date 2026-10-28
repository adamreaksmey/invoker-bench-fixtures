import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePage } from "../src/pages.js";

test("parsePage returns empty tags and full body when there is no front matter", () => {
  assert.deepEqual(parsePage("slug", "# Heading\n\nBody.\n"), {
    slug: "slug",
    title: "Heading",
    tags: [],
    body: "# Heading\n\nBody.\n",
  });
});

test("parsePage normalizes tags from bracket form", () => {
  const page = parsePage("slug", "---\ntags: [ops, Deploy, ops]\n---\nBody.\n");
  assert.deepEqual(page.tags, ["deploy", "ops"]);
});

test("parsePage normalizes tags from comma form", () => {
  const page = parsePage("slug", "---\ntags: ops, deploy\n---\nBody.\n");
  assert.deepEqual(page.tags, ["deploy", "ops"]);
});

test("parsePage falls back to heading when front matter title is missing", () => {
  const page = parsePage("slug", "---\ntags: a\n---\n# Heading\n");
  assert.equal(page.title, "Heading");
});

test("parsePage falls back to slug when there is no title or heading", () => {
  const page = parsePage("my-slug", "Just body text.\n");
  assert.equal(page.title, "my-slug");
});

test("parsePage handles empty tag values", () => {
  const page = parsePage("slug", "---\ntags:\n---\nBody.\n");
  assert.deepEqual(page.tags, []);
});
