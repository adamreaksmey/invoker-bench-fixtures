import { test } from "node:test";
import assert from "node:assert/strict";
import { createTemporaryApp, postJson, startServer } from "./helpers.js";

const VALID_URL = "https://example.com/docs";

async function withServer(run) {
  const temporaryApp = createTemporaryApp();
  const server = await startServer(temporaryApp.app);
  try {
    await run(server);
  } finally {
    await server.close();
    temporaryApp.close();
  }
}

async function postLink(server, body) {
  const response = await postJson(server.baseUrl, "/links", body);
  return { status: response.status, body: await response.json() };
}

test("rejects a missing or non-string url with 400", async () => {
  await withServer(async (server) => {
    for (const body of [{}, { url: "" }, { url: 42 }]) {
      const response = await postLink(server, body);
      assert.equal(response.status, 400);
      assert.equal(typeof response.body.error, "string");
    }
  });
});

test("rejects urls that are not absolute http or https with 400", async () => {
  await withServer(async (server) => {
    const invalidUrls = [
      "example.com",
      "//example.com/docs",
      "/relative/path",
      "ftp://example.com/file",
      "javascript:alert(1)",
      "mailto:someone@example.com",
      "http:/example.com",
    ];
    for (const url of invalidUrls) {
      const response = await postLink(server, { url });
      assert.equal(response.status, 400, `expected 400 for ${url}`);
      assert.equal(typeof response.body.error, "string");
    }
  });
});

test("accepts absolute http and https urls", async () => {
  await withServer(async (server) => {
    const httpLink = await postLink(server, { url: "http://example.com/a" });
    assert.equal(httpLink.status, 201);
    const httpsLink = await postLink(server, { url: "https://example.com/b?x=1#frag" });
    assert.equal(httpsLink.status, 201);
  });
});

test("rejects custom codes that do not match the allowed pattern with 400", async () => {
  await withServer(async (server) => {
    const invalidCodes = ["ab", "a".repeat(33), "has space", "bad#char", "emoji-😀", ".", "code/with/slash"];
    for (const code of invalidCodes) {
      const response = await postLink(server, { url: VALID_URL, code });
      assert.equal(response.status, 400, `expected 400 for code ${code}`);
      assert.equal(typeof response.body.error, "string");
    }
  });
});

test("accepts custom codes matching the allowed pattern", async () => {
  await withServer(async (server) => {
    const validCodes = ["abc", "A_b-9", "a".repeat(32), "001"];
    for (const code of validCodes) {
      const response = await postLink(server, { url: VALID_URL, code });
      assert.equal(response.status, 201, `expected 201 for code ${code}`);
      assert.equal(response.body.code, code);
    }
  });
});

test("returns 409 when the custom code already exists", async () => {
  await withServer(async (server) => {
    const first = await postLink(server, { url: VALID_URL, code: "duplicate" });
    assert.equal(first.status, 201);

    const second = await postLink(server, { url: "https://example.com/other", code: "duplicate" });
    assert.equal(second.status, 409);
    assert.equal(typeof second.body.error, "string");

    const metadata = await (await fetch(`${server.baseUrl}/links/duplicate`)).json();
    assert.equal(metadata.url, VALID_URL, "the original link must be unchanged");
  });
});

test("rejects an invalid url before rejecting an invalid custom code", async () => {
  await withServer(async (server) => {
    const response = await postLink(server, { url: "not-a-url", code: "x" });
    assert.equal(response.status, 400);
    assert.equal(typeof response.body.error, "string");
  });
});

test("generates a code when the custom code is omitted", async () => {
  await withServer(async (server) => {
    const response = await postLink(server, { url: VALID_URL });
    assert.equal(response.status, 201);
    assert.match(response.body.code, /^[A-Za-z0-9_-]{3,32}$/);
  });
});
