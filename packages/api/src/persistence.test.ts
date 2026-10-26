import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db";
import { createApp } from "./index";

describe("ledger persistence across restarts", () => {
  const dirs: string[] = [];
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns the same accounts, transactions, and balance after createApp reopens DATABASE_PATH", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-persist-"));
    dirs.push(dir);
    const databasePath = join(dir, "ledger.sqlite");
    const sessionSecret = "restart-survival-test-secret";

    db = openDatabase(databasePath);
    const firstApp = createApp({ db, sessionSecret });
    const registered = await request(firstApp)
      .post("/auth/register")
      .send({ username: "alice", password: "secret-password" })
      .expect(201);
    const cookie = registered.headers["set-cookie"][0].split(";")[0];

    await request(firstApp)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: "checking", name: "Checking" })
      .expect(201);
    await request(firstApp)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ id: "deposit", accountId: "checking", amountCents: 12_550, description: "paycheck" })
      .expect(201);
    await request(firstApp)
      .get("/accounts/checking/balance")
      .set("Cookie", cookie)
      .expect(200, { balanceCents: 12_550 });

    db.close();
    db = undefined;

    db = openDatabase(databasePath);
    const secondApp = createApp({ db, sessionSecret });
    const login = await request(secondApp)
      .post("/auth/login")
      .send({ username: "alice", password: "secret-password" })
      .expect(200);
    const nextCookie = login.headers["set-cookie"][0].split(";")[0];

    await request(secondApp)
      .get("/accounts")
      .set("Cookie", nextCookie)
      .expect(200, [{ id: "checking", name: "Checking" }]);
    await request(secondApp)
      .get("/transactions")
      .set("Cookie", nextCookie)
      .expect(200, [
        { id: "deposit", accountId: "checking", amountCents: 12_550, description: "paycheck" },
      ]);
    await request(secondApp)
      .get("/accounts/checking/balance")
      .set("Cookie", nextCookie)
      .expect(200, { balanceCents: 12_550 });
  });
});
