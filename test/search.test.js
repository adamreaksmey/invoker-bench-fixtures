import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODY_WEIGHT, MAX_SEARCH_RESULTS, TITLE_WEIGHT, buildMatchExpression, buildSnippet, parseSearchTerms, scorePage } from "../src/search.js";
import { makeTempPath, startApp } from "./helpers.js";

const TITLE_MATCH_PAGE = "# Deploy guide\n\nNothing about shipping in this page.\n";
const BODY_MATCH_PAGE = "# On-call handbook\n\nHow to deploy safely during an incident.\n";
const MULTI_HIT_PAGE = "# Runbook\n\nDeploy early, deploy often, then deploy again.\n";
const PUNCTUATION_PAGE = '# Quotes\n\nHe said "deploy" (twice!) -- and deploy: c++ edition.\n';
const UNRELATED_PAGE = "# Welcome\n\nStart here.\n";

function makePagesDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  for (const [slug, source] of Object.entries(files)) writeFileSync(join(dir, `${slug}.md`), source);
  return dir;
}

function startAppFor(files) {
  return startApp({ pagesDir: makePagesDir(files), indexPath: makeTempPath("wiki-index-", "index.sqlite") });
}

function search(baseUrl, query) {
  const suffix = query === undefined ? "" : `?q=${encodeURIComponent(query)}`;
  return fetch(`${baseUrl}/search${suffix}`);
}

function putPage(baseUrl, slug, body) {
  return fetch(`${baseUrl}/pages/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

test("search matches case-insensitively and returns query, slug, title, snippet, and score", async () => {
  const server = await startAppFor({ welcome: UNRELATED_PAGE });
  try {
    const body = await (await search(server.baseUrl, "START")).json();
    assert.equal(body.query, "START");
    assert.equal(body.results.length, 1);
    const [result] = body.results;
    assert.equal(result.slug, "welcome");
    assert.equal(result.title, "Welcome");
    assert.equal(typeof result.score, "number");
    assert.match(result.snippet, /\*\*Start\*\*/);
  } finally {
    await server.close();
  }
});

test("search requires every term to match", async () => {
  const server = await startAppFor({ deploy: TITLE_MATCH_PAGE, oncall: BODY_MATCH_PAGE, welcome: UNRELATED_PAGE });
  try {
    const both = await (await search(server.baseUrl, "deploy shipping")).json();
    assert.deepEqual(both.results.map((result) => result.slug), ["deploy"]);

    const oneTermMissing = await (await search(server.baseUrl, "deploy start")).json();
    assert.deepEqual(oneTermMissing.results, []);
  } finally {
    await server.close();
  }
});

test("search ranks title matches above body matches and repeats above single hits", async () => {
  const server = await startAppFor({
    handbooks: BODY_MATCH_PAGE,
    runbook: MULTI_HIT_PAGE,
    guides: TITLE_MATCH_PAGE,
    welcome: UNRELATED_PAGE,
  });
  try {
    const { results } = await (await search(server.baseUrl, "deploy")).json();
    assert.deepEqual(results.map((result) => result.slug), ["guides", "runbook", "handbooks"]);
    for (const result of results) assert.equal(typeof result.score, "number");
    assert.ok(results[0].score > results[1].score, "title match should outrank body match");
    assert.ok(results[1].score > results[2].score, "repeated body match should outrank a single one");
  } finally {
    await server.close();
  }
});

test("search returns at most MAX_SEARCH_RESULTS ranked results", async () => {
  const files = Object.fromEntries(
    Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, index) => [`page-${index}`, `# Page ${index}\n\ndeploy notes.\n`]),
  );
  const server = await startAppFor(files);
  try {
    const { results } = await (await search(server.baseUrl, "deploy")).json();
    assert.equal(results.length, MAX_SEARCH_RESULTS);
    for (const result of results) assert.equal(typeof result.score, "number");
  } finally {
    await server.close();
  }
});

test("search snippets excerpt the body and wrap every matched term in double asterisks", async () => {
  const server = await startAppFor({ oncall: BODY_MATCH_PAGE });
  try {
    const [result] = (await (await search(server.baseUrl, "deploy incident")).json()).results;
    assert.match(result.snippet, /\*\*deploy\*\*/);
    assert.match(result.snippet, /\*\*incident\*\*/);
    assert.ok(result.snippet.length < BODY_MATCH_PAGE.length, "snippet should be shorter than the whole page");
  } finally {
    await server.close();
  }
});

test("search treats punctuation and quotes as plain text instead of query syntax", async () => {
  const server = await startAppFor({ quotes: PUNCTUATION_PAGE, welcome: UNRELATED_PAGE });
  try {
    const quoted = await search(server.baseUrl, '"deploy"');
    assert.equal(quoted.status, 200);
    assert.deepEqual((await quoted.json()).results.map((result) => result.slug), ["quotes"]);

    for (const hostileQuery of ["deploy AND", "NEAR(deploy incident)", "deploy*", "(((", "-- deploy", "c++", "\\", "%", "_", "deploy OR welcome"]) {
      const response = await search(server.baseUrl, hostileQuery);
      assert.equal(response.status, 200, `expected 200 for ${JSON.stringify(hostileQuery)}`);
      const body = await response.json();
      assert.equal(body.query, hostileQuery);
      assert.ok(Array.isArray(body.results));
    }

    const punctuationOnly = await search(server.baseUrl, '"!?*"');
    assert.equal(punctuationOnly.status, 200);
    assert.deepEqual((await punctuationOnly.json()).results, []);
  } finally {
    await server.close();
  }
});

test("search rejects a missing or blank q with 400", async () => {
  const server = await startAppFor({ welcome: UNRELATED_PAGE });
  try {
    for (const suffix of ["", "?q=", "?q=%20%20", "?q=%09%0A"]) {
      const response = await fetch(`${server.baseUrl}/search${suffix}`);
      assert.equal(response.status, 400, `expected 400 for /search${suffix}`);
      const body = await response.json();
      assert.equal(typeof body.error, "string");
      assert.ok(body.error.length > 0);
    }
  } finally {
    await server.close();
  }
});

test("search terms drop punctuation so no query can reach FTS5 syntax", () => {
  assert.deepEqual(parseSearchTerms('  "Deploy"  '), ["deploy"]);
  assert.deepEqual(parseSearchTerms("deploy AND incident"), ["deploy", "and", "incident"]);
  assert.deepEqual(parseSearchTerms("deploy, deploy! DEPLOY"), ["deploy"]);
  assert.deepEqual(parseSearchTerms("café"), ["cafe"]);
  assert.deepEqual(parseSearchTerms('"!?*()"'), []);
  assert.deepEqual(parseSearchTerms(undefined), []);
  assert.deepEqual(parseSearchTerms(42), []);
});

test("buildMatchExpression ANDs every quoted term", () => {
  assert.equal(buildMatchExpression(["deploy", "incident"]), '"deploy" AND "incident"');
  assert.equal(buildMatchExpression(["cafe"]), '"cafe"');
});

test("a snippet keeps a body that already fits intact and returns empty for an empty body", () => {
  assert.equal(buildSnippet("short body deploy", ["deploy"]), "short body **deploy**");
  assert.equal(buildSnippet("", ["deploy"]), "");
  assert.equal(buildSnippet("   \n\t ", ["deploy"]), "");
});

test("a snippet near the end of a long body is windowed and marked with ellipses", () => {
  const filler = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
  const snippet = buildSnippet(`${filler} deploy at the end ${filler}`, ["deploy"]);
  assert.match(snippet, /\*\*deploy\*\*/);
  assert.ok(snippet.startsWith("..."), "leading ellipsis when the window starts mid-body");
  assert.ok(snippet.endsWith("..."), "trailing ellipsis when the window stops mid-body");
  assert.ok(snippet.length < filler.length, "snippet should be much shorter than the body");
});

test("scorePage weights title hits above body hits and sums every term", () => {
  assert.equal(scorePage({ title: "Deploy", body: "nothing" }, ["deploy"]), TITLE_WEIGHT);
  assert.equal(scorePage({ title: "Nothing", body: "deploy" }, ["deploy"]), BODY_WEIGHT);
  assert.equal(scorePage({ title: "Deploy", body: "deploy deploy" }, ["deploy"]), TITLE_WEIGHT + 2 * BODY_WEIGHT);
  assert.equal(scorePage({ title: "Deploy incident", body: "" }, ["deploy", "incident"]), 2 * TITLE_WEIGHT);
  assert.equal(scorePage({ title: "Nothing", body: "nothing" }, ["deploy"]), 0);
});

test("search only matches body text, not other front-matter keys", async () => {
  const server = await startAppFor({
    plain: "---\ntitle: Plain\nsecretkey: hiddenvalue\n---\n# Plain\n\nnothing here\n",
  });
  try {
    assert.deepEqual((await (await search(server.baseUrl, "hiddenvalue")).json()).results, []);
    assert.deepEqual((await (await search(server.baseUrl, "plain")).json()).results.map((result) => result.slug), ["plain"]);
  } finally {
    await server.close();
  }
});

test("search matches the front-matter title", async () => {
  const server = await startAppFor({
    runbook: "---\ntitle: uniquefrontmattertitle\n---\nbody with nothing special\n",
  });
  try {
    const { results } = await (await search(server.baseUrl, "uniquefrontmattertitle")).json();
    assert.equal(results.length, 1);
    assert.equal(results[0].slug, "runbook");
    assert.equal(results[0].title, "uniquefrontmattertitle");
    assert.ok(results[0].score > 0);
  } finally {
    await server.close();
  }
});

test("search breaks score ties by slug so ordering is deterministic", async () => {
  const server = await startAppFor({
    zulu: "# Zulu\n\ndeploy notes.\n",
    alpha: "# Alpha\n\ndeploy notes.\n",
    mike: "# Mike\n\ndeploy notes.\n",
  });
  try {
    const { results } = await (await search(server.baseUrl, "deploy")).json();
    assert.deepEqual(results.map((result) => result.slug), ["alpha", "mike", "zulu"]);
    assert.equal(new Set(results.map((result) => result.score)).size, 1, "all three should tie");
  } finally {
    await server.close();
  }
});

test("search reads the index, so PUT and DELETE are reflected immediately", async () => {
  const server = await startAppFor({ welcome: UNRELATED_PAGE });
  try {
    assert.deepEqual((await (await search(server.baseUrl, "runbook")).json()).results, []);

    assert.equal((await putPage(server.baseUrl, "runbook", "# Runbook\n\nDeploy steps for the runbook.\n")).status, 201);
    assert.deepEqual((await (await search(server.baseUrl, "runbook")).json()).results.map((result) => result.slug), ["runbook"]);

    assert.equal((await fetch(`${server.baseUrl}/pages/runbook`, { method: "DELETE" })).status, 204);
    assert.deepEqual((await (await search(server.baseUrl, "runbook")).json()).results, []);
  } finally {
    await server.close();
  }
});
