import { test } from "node:test";
import assert from "node:assert/strict";
import { createTemporaryApp, postJson, startServer } from "./helpers.js";

const WINDOW_MS = 60_000;
const WINDOW_START_MS = 1_800_000_000_000;
const LIMIT_MAX = 3;
const DEFAULT_LIMIT_MAX = 20;
const FIRST_CUSTOM_IP = "203.0.113.7";
const SECOND_CUSTOM_IP = "203.0.113.8";
const LINK_CREATION_PATH = "/links";
const MINIMUM_RETRY_AFTER_SECONDS = 1;

function createSettableClock(initialMs) {
  let currentMs = initialMs;
  return {
    now: () => currentMs,
    set(nextMs) {
      currentMs = nextMs;
    },
  };
}

function requireRetryAfterSeconds(response) {
  const headerValue = response.headers.get("retry-after");
  assert.ok(headerValue !== null, "Retry-After header must be present");
  const retryAfterSeconds = Number(headerValue);
  assert.ok(Number.isInteger(retryAfterSeconds), "Retry-After must be a whole number");
  assert.ok(
    retryAfterSeconds >= MINIMUM_RETRY_AFTER_SECONDS,
    "Retry-After must be at least one second",
  );
  return retryAfterSeconds;
}

function postLink(server, body = { url: "https://example.com/limited" }, headers = {}) {
  return postJson(server.baseUrl, LINK_CREATION_PATH, body, headers);
}

async function createAllowedLinks(server, count, headers = {}) {
  for (let requestIndex = 0; requestIndex < count; requestIndex += 1) {
    const response = await postLink(server, { url: `https://example.com/${requestIndex}` }, headers);
    assert.equal(response.status, 201);
  }
}

async function exhaustLimit(server, headers = {}) {
  await createAllowedLinks(server, LIMIT_MAX, headers);
}

async function startLimitedServer(clock, options = {}) {
  const temporaryApp = createTemporaryApp({
    now: clock.now,
    rateLimitMax: LIMIT_MAX,
    rateLimitWindowMs: WINDOW_MS,
    ...options,
  });
  const server = await startServer(temporaryApp.app);
  return { temporaryApp, server };
}

test("requests above the limit get 429 with an error body and Retry-After", async () => {
  const clock = createSettableClock(WINDOW_START_MS);
  const { temporaryApp, server } = await startLimitedServer(clock);
  try {
    await exhaustLimit(server);

    const limited = await postLink(server);
    assert.equal(limited.status, 429);
    const body = await limited.json();
    assert.equal(typeof body.error, "string");
    assert.equal(requireRetryAfterSeconds(limited), 60);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("Retry-After rounds remaining window time up to whole seconds", async () => {
  const clock = createSettableClock(WINDOW_START_MS + WINDOW_MS - 1_500);
  const { temporaryApp, server } = await startLimitedServer(clock);
  try {
    await exhaustLimit(server);

    const limited = await postLink(server);
    assert.equal(limited.status, 429);
    assert.equal(requireRetryAfterSeconds(limited), 2);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("Retry-After never drops below one second", async () => {
  const clock = createSettableClock(WINDOW_START_MS + WINDOW_MS - 1);
  const { temporaryApp, server } = await startLimitedServer(clock);
  try {
    await exhaustLimit(server);

    const limited = await postLink(server);
    assert.equal(limited.status, 429);
    assert.equal(requireRetryAfterSeconds(limited), MINIMUM_RETRY_AFTER_SECONDS);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("a rejected request does not create a link", async () => {
  const clock = createSettableClock(WINDOW_START_MS);
  const { temporaryApp, server } = await startLimitedServer(clock);
  try {
    await exhaustLimit(server);

    const rejected = await postLink(server, { url: "https://example.com/blocked", code: "blocked" });
    assert.equal(rejected.status, 429);
    const metadata = await fetch(`${server.baseUrl}/links/blocked`);
    assert.equal(metadata.status, 404);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("the limit resets when the next fixed window starts", async () => {
  const clock = createSettableClock(WINDOW_START_MS);
  const { temporaryApp, server } = await startLimitedServer(clock);
  try {
    await exhaustLimit(server);
    assert.equal((await postLink(server)).status, 429);

    clock.set(WINDOW_START_MS + WINDOW_MS);
    const afterWindow = await postLink(server);
    assert.equal(afterWindow.status, 201);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("each client IP gets its own counter", async () => {
  const clock = createSettableClock(WINDOW_START_MS);
  const { temporaryApp, server } = await startLimitedServer(clock);
  temporaryApp.app.set("trust proxy", true);
  try {
    await exhaustLimit(server, { "x-forwarded-for": FIRST_CUSTOM_IP });
    const limitedForFirstIp = await postLink(server, undefined, {
      "x-forwarded-for": FIRST_CUSTOM_IP,
    });
    assert.equal(limitedForFirstIp.status, 429);

    const allowedForSecondIp = await postLink(server, undefined, {
      "x-forwarded-for": SECOND_CUSTOM_IP,
    });
    assert.equal(allowedForSecondIp.status, 201);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("redirects and stats are never rate limited", async () => {
  const clock = createSettableClock(WINDOW_START_MS);
  const { temporaryApp, server } = await startLimitedServer(clock);
  try {
    const created = await postLink(server, { url: "https://example.com/reads", code: "reads" });
    assert.equal(created.status, 201);
    await createAllowedLinks(server, LIMIT_MAX - 1);
    assert.equal((await postLink(server)).status, 429);

    for (let requestIndex = 0; requestIndex < LIMIT_MAX; requestIndex += 1) {
      const redirect = await fetch(`${server.baseUrl}/reads`, { redirect: "manual" });
      assert.equal(redirect.status, 302);
      const stats = await fetch(`${server.baseUrl}/links/reads/stats`);
      assert.equal(stats.status, 200);
    }
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("the default limit allows 20 creations and rejects the 21st", async () => {
  const clock = createSettableClock(WINDOW_START_MS);
  const temporaryApp = createTemporaryApp({ now: clock.now });
  const server = await startServer(temporaryApp.app);
  try {
    for (let requestIndex = 0; requestIndex < DEFAULT_LIMIT_MAX; requestIndex += 1) {
      const response = await postLink(server, { url: `https://example.com/${requestIndex}` });
      assert.equal(response.status, 201);
    }

    const limited = await postLink(server);
    assert.equal(limited.status, 429);
    requireRetryAfterSeconds(limited);
  } finally {
    await server.close();
    temporaryApp.close();
  }
});

test("RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS supply the defaults", async () => {
  const clock = createSettableClock(WINDOW_START_MS);
  const previousMax = process.env.RATE_LIMIT_MAX;
  const previousWindowMs = process.env.RATE_LIMIT_WINDOW_MS;
  process.env.RATE_LIMIT_MAX = "1";
  process.env.RATE_LIMIT_WINDOW_MS = String(WINDOW_MS);
  const temporaryApp = createTemporaryApp({ now: clock.now });
  const server = await startServer(temporaryApp.app);
  try {
    assert.equal((await postLink(server)).status, 201);
    const limited = await postLink(server);
    assert.equal(limited.status, 429);
    assert.equal(requireRetryAfterSeconds(limited), 60);
  } finally {
    await server.close();
    temporaryApp.close();
    restoreEnvironmentVariable("RATE_LIMIT_MAX", previousMax);
    restoreEnvironmentVariable("RATE_LIMIT_WINDOW_MS", previousWindowMs);
  }
});

function restoreEnvironmentVariable(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previousValue;
}
