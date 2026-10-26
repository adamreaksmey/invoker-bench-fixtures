import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
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
});
