import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import request from "supertest";
import { openDatabase } from "./db";
import { createApp } from "./index";

const TEMP_DIR_PREFIX = "ledger-api-";
const DB_FILENAME = "ledger.sqlite";
const SESSION_SECRET = "test-session-secret";
const USERNAME = "alice";
const PASSWORD = "secret";
const CHECKING_ID = "checking";
const SAVINGS_ID = "savings";
const PAY_TX_ID = "pay";
const RENT_TX_ID = "rent";
const TRANSFER_TX_ID = "transfer";
const DEPOSIT_CENTS = 125_050;
const RENT_CENTS = -80_025;
const TRANSFER_CENTS = 10_000;
const CHECKING_BALANCE_CENTS = 45_025;

describe("persisted ledger API", () => {
  let db: DatabaseSync | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates and lists accounts for the authenticated user", async () => {
    const { server, cookie } = await openAuthenticatedApp();

    await request(server).get("/accounts").expect(401);
    await request(server)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: CHECKING_ID, name: "Checking" })
      .expect(201, { id: CHECKING_ID, name: "Checking" });
    await request(server)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: SAVINGS_ID, name: "Savings" })
      .expect(201);
    await request(server)
      .get("/accounts")
      .set("Cookie", cookie)
      .expect(200, [
        { id: CHECKING_ID, name: "Checking" },
        { id: SAVINGS_ID, name: "Savings" },
      ]);
    await request(server)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: CHECKING_ID, name: "Dup" })
      .expect(400);
  });

  it("records transactions, filters by accountId, and returns balanceCents", async () => {
    const { server, cookie } = await openAuthenticatedApp();
    await request(server)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: CHECKING_ID, name: "Checking" })
      .expect(201);
    await request(server)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: SAVINGS_ID, name: "Savings" })
      .expect(201);

    await request(server).post("/transactions").send({
      id: PAY_TX_ID,
      accountId: CHECKING_ID,
      amountCents: DEPOSIT_CENTS,
    }).expect(401);

    await request(server)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({
        id: PAY_TX_ID,
        accountId: CHECKING_ID,
        amountCents: DEPOSIT_CENTS,
        description: " paycheck ",
      })
      .expect(201, {
        id: PAY_TX_ID,
        accountId: CHECKING_ID,
        amountCents: DEPOSIT_CENTS,
        description: "paycheck",
      });
    await request(server)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ id: RENT_TX_ID, accountId: CHECKING_ID, amountCents: RENT_CENTS })
      .expect(201);
    await request(server)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ id: TRANSFER_TX_ID, accountId: SAVINGS_ID, amountCents: TRANSFER_CENTS })
      .expect(201);

    await request(server)
      .get("/transactions")
      .set("Cookie", cookie)
      .expect(200, [
        {
          id: PAY_TX_ID,
          accountId: CHECKING_ID,
          amountCents: DEPOSIT_CENTS,
          description: "paycheck",
        },
        { id: RENT_TX_ID, accountId: CHECKING_ID, amountCents: RENT_CENTS },
        { id: TRANSFER_TX_ID, accountId: SAVINGS_ID, amountCents: TRANSFER_CENTS },
      ]);
    await request(server)
      .get(`/transactions?accountId=${CHECKING_ID}`)
      .set("Cookie", cookie)
      .expect(200, [
        {
          id: PAY_TX_ID,
          accountId: CHECKING_ID,
          amountCents: DEPOSIT_CENTS,
          description: "paycheck",
        },
        { id: RENT_TX_ID, accountId: CHECKING_ID, amountCents: RENT_CENTS },
      ]);
    await request(server)
      .get(`/accounts/${CHECKING_ID}/balance`)
      .set("Cookie", cookie)
      .expect(200, { balanceCents: CHECKING_BALANCE_CENTS });
    await request(server)
      .get(`/accounts/${SAVINGS_ID}/balance`)
      .set("Cookie", cookie)
      .expect(200, { balanceCents: TRANSFER_CENTS });
  });

  it("maps unknown accounts to 404 and validation errors to 400", async () => {
    const { server, cookie } = await openAuthenticatedApp();
    await request(server)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: CHECKING_ID, name: "Checking" })
      .expect(201);

    await request(server)
      .get("/accounts/missing/balance")
      .set("Cookie", cookie)
      .expect(404);
    await request(server)
      .get("/transactions?accountId=missing")
      .set("Cookie", cookie)
      .expect(404);
    await request(server)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ id: PAY_TX_ID, accountId: "missing", amountCents: 1 })
      .expect(404);

    await request(server)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: "  ", name: "Empty" })
      .expect(400);
    await request(server)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ id: PAY_TX_ID, accountId: CHECKING_ID, amountCents: 0 })
      .expect(400);
    await request(server)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ id: PAY_TX_ID, accountId: CHECKING_ID, amountCents: 1 })
      .expect(201);
    await request(server)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({ id: PAY_TX_ID, accountId: CHECKING_ID, amountCents: 2 })
      .expect(400);
  });

  it("returns the same ledger data from a new createApp on the same DATABASE_PATH", async () => {
    const dbPath = createTempDbPath();
    const firstDb = openDatabase(dbPath);
    const firstApp = createApp({ db: firstDb, sessionSecret: SESSION_SECRET });
    const registered = await request(firstApp)
      .post("/auth/register")
      .send({ username: USERNAME, password: PASSWORD })
      .expect(201);
    const cookie = sessionCookie(registered);

    await request(firstApp)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ id: CHECKING_ID, name: "Checking" })
      .expect(201);
    await request(firstApp)
      .post("/transactions")
      .set("Cookie", cookie)
      .send({
        id: PAY_TX_ID,
        accountId: CHECKING_ID,
        amountCents: DEPOSIT_CENTS,
        description: "paycheck",
      })
      .expect(201);
    await request(firstApp)
      .get(`/accounts/${CHECKING_ID}/balance`)
      .set("Cookie", cookie)
      .expect(200, { balanceCents: DEPOSIT_CENTS });
    firstDb.close();

    db = openDatabase(dbPath);
    const secondApp = createApp({ db, sessionSecret: SESSION_SECRET });
    const login = await request(secondApp)
      .post("/auth/login")
      .send({ username: USERNAME, password: PASSWORD })
      .expect(200);
    const secondCookie = sessionCookie(login);

    await request(secondApp)
      .get("/accounts")
      .set("Cookie", secondCookie)
      .expect(200, [{ id: CHECKING_ID, name: "Checking" }]);
    await request(secondApp)
      .get("/transactions")
      .set("Cookie", secondCookie)
      .expect(200, [
        {
          id: PAY_TX_ID,
          accountId: CHECKING_ID,
          amountCents: DEPOSIT_CENTS,
          description: "paycheck",
        },
      ]);
    await request(secondApp)
      .get(`/accounts/${CHECKING_ID}/balance`)
      .set("Cookie", secondCookie)
      .expect(200, { balanceCents: DEPOSIT_CENTS });
  });

  async function openAuthenticatedApp() {
    db = openDatabase(":memory:");
    const server = createApp({ db, sessionSecret: SESSION_SECRET });
    const registered = await request(server)
      .post("/auth/register")
      .send({ username: USERNAME, password: PASSWORD })
      .expect(201);
    return { server, cookie: sessionCookie(registered) };
  }

  function createTempDbPath(): string {
    tempDir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
    return join(tempDir, DB_FILENAME);
  }
});

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") throw new Error("Expected Set-Cookie header");
  return first.split(";")[0];
}
