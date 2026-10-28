import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

export async function startServer(app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Starts an app from options and closes both the server and its index on close. */
export async function startApp(options) {
  const app = createApp(options);
  const server = await startServer(app);
  return {
    baseUrl: server.baseUrl,
    app,
    close: async () => {
      await server.close();
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

/** Returns a path inside a fresh temporary directory, for throwaway SQLite files. */
export function makeTempPath(prefix, fileName) {
  return join(mkdtempSync(join(tmpdir(), prefix)), fileName);
}
