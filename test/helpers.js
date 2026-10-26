import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

const TEMP_DIR_PREFIX = "shortener-";
const TEST_DATABASE_FILENAME = "test.sqlite";

export function createTestApp(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
  const databasePath = join(directory, TEST_DATABASE_FILENAME);
  return createApp({ databasePath, ...options });
}

export async function startServer(app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      app.locals.close();
    },
  };
}

export function postJson(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
