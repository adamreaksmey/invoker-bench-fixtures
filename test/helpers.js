import { mkdtempSync, rmSync } from "node:fs";
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
    close() {
      closeApp(app);
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

export function closeApp(app) {
  app.locals.close();
}

export function createTemporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "link-shortener-"));
  return {
    databasePath: join(directory, "shortener.sqlite"),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export function createTemporaryApp(options = {}) {
  const temporaryDatabase = createTemporaryDatabasePath();
  const app = createApp({ ...options, databasePath: temporaryDatabase.databasePath });
  return {
    app,
    databasePath: temporaryDatabase.databasePath,
    close() {
      closeApp(app);
      temporaryDatabase.remove();
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
