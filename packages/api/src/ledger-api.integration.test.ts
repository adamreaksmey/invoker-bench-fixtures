import { afterEach, describe, expect, it } from "vitest";
import request, { type Response } from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createApp } from "./index";
import { openDatabase } from "./db";

describe("ledger API", () => {
  let db: DatabaseSync | undefined;
  let directory: string | undefined;
  const originalDatabasePath = process.env.DATABASE_PATH;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
  });

  function createTestApp() {
    db = openDatabase(":memory:");
    return createApp({ db, sessionSecret: "test-session-secret" });
  }

  function cookie(response: Response): string {
    return response.headers["set-cookie"][0].split(";")[0];
  }

  it("creates accounts and transactions and returns their balance", async () => {
    const app = createTestApp();
    const registration = await request(app)
      .post("/auth/register")
      .send({ username: "alice", password: "secret" })
      .expect(201);
    const session = cookie(registration);

    await request(app).get("/accounts").set("Cookie", session).expect(200, []);
    await request(app)
      .post("/accounts")
      .set("Cookie", session)
      .send({ id: "checking", name: "Checking" })
      .expect(201, { id: "checking", name: "Checking" });
    await request(app)
      .post("/transactions")
      .set("Cookie", session)
      .send({ id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" })
      .expect(201, { id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" });
    await request(app)
      .post("/transactions")
      .set("Cookie", session)
      .send({ id: "coffee", accountId: "checking", amountCents: -350 })
      .expect(201, { id: "coffee", accountId: "checking", amountCents: -350 });

    await request(app).get("/accounts").set("Cookie", session).expect(200, [
      { id: "checking", name: "Checking" },
    ]);
    await request(app).get("/transactions?accountId=checking").set("Cookie", session).expect(200, [
      { id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" },
      { id: "coffee", accountId: "checking", amountCents: -350 },
    ]);
    await request(app).get("/accounts/checking/balance").set("Cookie", session)
      .expect(200, { balanceCents: 12200 });
  });

  it("isolates ledger data and survives a new app instance", async () => {
    directory = mkdtempSync(join(tmpdir(), "personal-ledger-api-"));
    const filename = join(directory, "ledger.sqlite");
    db = openDatabase(filename);
    const firstApp = createApp({ db, sessionSecret: "test-session-secret" });
    const registration = await request(firstApp)
      .post("/auth/register")
      .send({ username: "alice", password: "secret" })
      .expect(201);
    const aliceSession = cookie(registration);
    await request(firstApp).post("/accounts").set("Cookie", aliceSession)
      .send({ id: "checking", name: "Checking" }).expect(201);
    await request(firstApp).post("/transactions").set("Cookie", aliceSession)
      .send({ id: "payday", accountId: "checking", amountCents: 12550 }).expect(201);

    const bobRegistration = await request(firstApp)
      .post("/auth/register")
      .send({ username: "bob", password: "secret" })
      .expect(201);
    const bobSession = cookie(bobRegistration);
    await request(firstApp).get("/accounts").set("Cookie", bobSession).expect(200, []);

    db.close();
    db = openDatabase(filename);
    const restartedApp = createApp({ db, sessionSecret: "test-session-secret" });
    await request(restartedApp).get("/accounts").set("Cookie", aliceSession).expect(200, [
      { id: "checking", name: "Checking" },
    ]);
    await request(restartedApp).get("/transactions").set("Cookie", aliceSession).expect(200, [
      { id: "payday", accountId: "checking", amountCents: 12550 },
    ]);
    await request(restartedApp).get("/accounts/checking/balance").set("Cookie", aliceSession)
      .expect(200, { balanceCents: 12550 });
    await request(restartedApp).get("/accounts").set("Cookie", bobSession).expect(200, []);
  });

  it("preserves accounts, transactions, and balances across createApp restarts", async () => {
    directory = mkdtempSync(join(tmpdir(), "personal-ledger-api-restart-"));
    process.env.DATABASE_PATH = join(directory, "ledger.sqlite");

    const firstApp = createApp({ sessionSecret: "test-session-secret" });
    const registration = await request(firstApp)
      .post("/auth/register")
      .send({ username: "alice", password: "secret" })
      .expect(201);
    const session = cookie(registration);

    await request(firstApp)
      .post("/accounts")
      .set("Cookie", session)
      .send({ id: "checking", name: "Checking" })
      .expect(201, { id: "checking", name: "Checking" });
    await request(firstApp)
      .post("/transactions")
      .set("Cookie", session)
      .send({ id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" })
      .expect(201, { id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" });
    await request(firstApp)
      .post("/transactions")
      .set("Cookie", session)
      .send({ id: "coffee", accountId: "checking", amountCents: -350 })
      .expect(201, { id: "coffee", accountId: "checking", amountCents: -350 });

    const restartedApp = createApp({ sessionSecret: "test-session-secret" });
    await request(restartedApp).get("/accounts").set("Cookie", session).expect(200, [
      { id: "checking", name: "Checking" },
    ]);
    await request(restartedApp).get("/transactions").set("Cookie", session).expect(200, [
      { id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" },
      { id: "coffee", accountId: "checking", amountCents: -350 },
    ]);
    await request(restartedApp).get("/accounts/checking/balance").set("Cookie", session)
      .expect(200, { balanceCents: 12200 });
  });
});
