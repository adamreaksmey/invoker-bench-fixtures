import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db";
import { createApp } from "./index";

describe("authentication and ledger API", () => {
  let db: DatabaseSync | undefined;
  afterEach(() => { db?.close(); db = undefined; });

  function app() {
    db = openDatabase(":memory:");
    return createApp({ db, sessionSecret: "test-session-secret" });
  }

  it("registers, logs in, identifies the user, and revokes the session on logout", async () => {
    const server = app();
    const registered = await request(server).post("/auth/register").send({ username: "alice", password: "secret" }).expect(201);
    expect(registered.body.user).toMatchObject({ username: "alice" });
    expect(registered.body.user).not.toHaveProperty("passwordHash");
    const cookie = registered.headers["set-cookie"][0].split(";")[0];
    expect(registered.headers["set-cookie"][0]).toMatch(/HttpOnly/i);
    expect((await request(server).get("/auth/me").set("Cookie", cookie).expect(200)).body.user.id).toBe(registered.body.user.id);

    await request(server).post("/auth/logout").set("Cookie", cookie).expect(204);
    await request(server).get("/auth/me").set("Cookie", cookie).expect(401);
    await request(server).post("/auth/login").send({ username: "alice", password: "secret" }).expect(200);
    await request(server).post("/auth/login").send({ username: "alice", password: "bad" }).expect(401);
  });

  it("validates registration input and reports duplicate usernames", async () => {
    const server = app();
    await request(server).post("/auth/register").send({ username: "x", password: "pw" }).expect(400);
    await request(server).post("/auth/register").send({ username: "alice", password: "pw" }).expect(201);
    await request(server).post("/auth/register").send({ username: "alice", password: "pw" }).expect(409);
  });

  it("requires valid auth for ledger writes and isolates each user's ledger", async () => {
    const server = app();
    await request(server).post("/accounts").send({ id: "checking", name: "Checking" }).expect(401);
    await request(server).post("/transactions").send({ id: "pay", accountId: "checking", amountCents: 100 }).expect(401);

    const alice = await request(server).post("/auth/register").send({ username: "alice", password: "secret" }).expect(201);
    const aliceCookie = alice.headers["set-cookie"][0].split(";")[0];
    await request(server).post("/accounts").set("Cookie", aliceCookie).send({ id: "checking", name: "Checking" }).expect(201);
    await request(server).post("/transactions").set("Cookie", aliceCookie)
      .send({ id: "pay", accountId: "checking", amountCents: 1234 }).expect(201);
    await request(server).get("/accounts/checking/balance").set("Cookie", aliceCookie).expect(200, { balanceCents: 1234 });

    const bob = await request(server).post("/auth/register").send({ username: "bob", password: "secret" }).expect(201);
    const bobCookie = bob.headers["set-cookie"][0].split(";")[0];
    await request(server).get("/accounts").set("Cookie", bobCookie).expect(200, []);
    await request(server).post("/accounts").set("Cookie", bobCookie).send({ id: "checking", name: "Bob checking" }).expect(201);
    await request(server).post("/accounts").set("Cookie", aliceCookie).send({ id: "savings", name: "Savings" }).expect(201);
    await request(server).get("/accounts").set("Cookie", aliceCookie).expect(200, [
      { id: "checking", name: "Checking" }, { id: "savings", name: "Savings" },
    ]);
  });

  it("supports account, transaction, filtered transaction, and balance operations", async () => {
    const server = app();
    const registered = await request(server).post("/auth/register")
      .send({ username: "alice", password: "secret" }).expect(201);
    const cookie = registered.headers["set-cookie"][0].split(";")[0];

    await request(server).get("/accounts").set("Cookie", cookie).expect(200, []);
    await request(server).post("/accounts").set("Cookie", cookie)
      .send({ id: " checking ", name: " Main checking " })
      .expect(201, { id: "checking", name: "Main checking" });
    await request(server).post("/accounts").set("Cookie", cookie)
      .send({ id: "savings", name: "Savings" }).expect(201);

    await request(server).post("/transactions").set("Cookie", cookie)
      .send({ id: "deposit", accountId: "checking", amountCents: 12550, description: " pay " })
      .expect(201, { id: "deposit", accountId: "checking", amountCents: 12550, description: "pay" });
    await request(server).post("/transactions").set("Cookie", cookie)
      .send({ id: "withdrawal", accountId: "checking", amountCents: -250 }).expect(201);
    await request(server).post("/transactions").set("Cookie", cookie)
      .send({ id: "saving", accountId: "savings", amountCents: 900 }).expect(201);

    await request(server).get("/transactions").set("Cookie", cookie).expect(200, [
      { id: "deposit", accountId: "checking", amountCents: 12550, description: "pay" },
      { id: "withdrawal", accountId: "checking", amountCents: -250 },
      { id: "saving", accountId: "savings", amountCents: 900 },
    ]);
    await request(server).get("/transactions?accountId=checking").set("Cookie", cookie).expect(200, [
      { id: "deposit", accountId: "checking", amountCents: 12550, description: "pay" },
      { id: "withdrawal", accountId: "checking", amountCents: -250 },
    ]);
    await request(server).get("/accounts/checking/balance").set("Cookie", cookie)
      .expect(200, { balanceCents: 12300 });
    await request(server).post("/transactions").set("Cookie", cookie)
      .send({ id: "missing", accountId: "unknown", amountCents: 1 }).expect(404);
  });

  it("survives a new app instance using the same database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ledger-api-"));
    const filename = join(directory, "ledger.sqlite");
    const previousDatabasePath = process.env.DATABASE_PATH;
    try {
      process.env.DATABASE_PATH = filename;
      const firstApp = createApp({ sessionSecret: "test-session-secret" });
      const registered = await request(firstApp).post("/auth/register")
        .send({ username: "alice", password: "secret" }).expect(201);
      const cookie = registered.headers["set-cookie"][0].split(";")[0];
      await request(firstApp).post("/accounts").set("Cookie", cookie)
        .send({ id: "checking", name: "Checking" }).expect(201);
      await request(firstApp).post("/transactions").set("Cookie", cookie)
        .send({ id: "deposit", accountId: "checking", amountCents: 12550, description: "Payday" }).expect(201);
      await request(firstApp).post("/accounts").set("Cookie", cookie)
        .send({ id: "savings", name: "Savings" }).expect(201);
      await request(firstApp).post("/transactions").set("Cookie", cookie)
        .send({ id: "transfer", accountId: "savings", amountCents: 5000 }).expect(201);

      const secondApp = createApp({ sessionSecret: "test-session-secret" });
      await request(secondApp).get("/accounts").set("Cookie", cookie)
        .expect(200, [
          { id: "checking", name: "Checking" },
          { id: "savings", name: "Savings" },
        ]);
      await request(secondApp).get("/transactions").set("Cookie", cookie)
        .expect(200, [
          { id: "deposit", accountId: "checking", amountCents: 12550, description: "Payday" },
          { id: "transfer", accountId: "savings", amountCents: 5000 },
        ]);
      await request(secondApp).get("/accounts/checking/balance").set("Cookie", cookie)
        .expect(200, { balanceCents: 12550 });
      await request(secondApp).get("/accounts/savings/balance").set("Cookie", cookie)
        .expect(200, { balanceCents: 5000 });
    } finally {
      if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousDatabasePath;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
