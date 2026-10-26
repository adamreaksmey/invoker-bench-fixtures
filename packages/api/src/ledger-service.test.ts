import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AuthStore } from "./auth-store";
import { openDatabase } from "./db";
import { LedgerStore } from "./ledger-store";
import { LedgerService, createLedgerService } from "./ledger-service";

const TEMP_DIR_PREFIX = "ledger-service-";
const DB_FILENAME = "ledger.sqlite";
const USER_PASSWORD = "passphrase-for-tests";
const UNSAFE_INTEGER = Number.MAX_SAFE_INTEGER + 1;

describe("LedgerService", () => {
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

  it("creates accounts and computes balances from signed integer cents", async () => {
    const service = await openServiceForUser("alice");
    service.addAccount({ id: "checking", name: "Checking" });
    service.addAccount({ id: "savings", name: "Savings" });
    service.addTransaction({ id: "pay", accountId: "checking", amountCents: 125_050 });
    service.addTransaction({ id: "rent", accountId: "checking", amountCents: -80_025 });
    service.addTransaction({ id: "transfer", accountId: "savings", amountCents: 10_000 });

    expect(service.getBalance("checking")).toBe(45_025);
    expect(service.getBalance("savings")).toBe(10_000);
    expect(service.listTransactions("checking").map(({ id }) => id)).toEqual(["pay", "rent"]);
  });

  it("trims ids and names and does not expose mutable internal records", async () => {
    const service = await openServiceForUser("trimmer");
    const account = service.addAccount({ id: "  a  ", name: "  Main  " });
    account.name = "Changed";
    service.addTransaction({
      id: "  t  ",
      accountId: "a",
      amountCents: 1,
      description: "  deposit  ",
    });
    const transactions = service.listTransactions();
    transactions[0].amountCents = 50;

    expect(service.getAccount("a")?.name).toBe("Main");
    expect(service.listAccounts()).toEqual([{ id: "a", name: "Main" }]);
    expect(service.getBalance("a")).toBe(1);
    expect(service.listTransactions()[0].description).toBe("deposit");
  });

  it("rejects empty ids and names", async () => {
    const service = await openServiceForUser("empty");
    expect(() => service.addAccount({ id: "   ", name: "Main" })).toThrow(/Account id/);
    expect(() => service.addAccount({ id: "a", name: "  " })).toThrow(/Account name/);
    service.addAccount({ id: "a", name: "Main" });
    expect(() =>
      service.addTransaction({ id: "", accountId: "a", amountCents: 1 }),
    ).toThrow(/Transaction id/);
    expect(() =>
      service.addTransaction({ id: "t", accountId: "  ", amountCents: 1 }),
    ).toThrow(/Account id/);
  });

  it("rejects duplicate ids, missing accounts, and invalid amounts", async () => {
    const service = await openServiceForUser("validator");
    service.addAccount({ id: "a", name: "Main" });

    expect(() => service.addAccount({ id: "a", name: "Other" })).toThrow(/already exists/);
    expect(() =>
      service.addTransaction({ id: "t", accountId: "missing", amountCents: 1 }),
    ).toThrow(/Unknown account/);
    expect(() =>
      service.addTransaction({ id: "t", accountId: "a", amountCents: 0 }),
    ).toThrow(/cannot be zero/);
    expect(() =>
      service.addTransaction({ id: "t", accountId: "a", amountCents: 1.5 }),
    ).toThrow(/safe integer/);
    expect(() =>
      service.addTransaction({ id: "t", accountId: "a", amountCents: UNSAFE_INTEGER }),
    ).toThrow(/safe integer/);
    service.addTransaction({ id: "t", accountId: "a", amountCents: 1 });
    expect(() =>
      service.addTransaction({ id: "t", accountId: "a", amountCents: 2 }),
    ).toThrow(/already exists/);
    expect(service.getBalance("a")).toBe(1);
  });

  it("rejects unknown balance and transaction queries", async () => {
    const service = await openServiceForUser("unknown");
    expect(() => service.getBalance("missing")).toThrow(/Unknown account/);
    expect(() => service.listTransactions("missing")).toThrow(/Unknown account/);
  });

  it("createLedgerService returns a working service", async () => {
    const path = createTempDbPath();
    db = openDatabase(path);
    const user = await new AuthStore(db).createUser("factory", USER_PASSWORD);
    const service = createLedgerService(new LedgerStore(db, user.id));
    service.addAccount({ id: "a", name: "Main" });
    expect(service.listAccounts()).toEqual([{ id: "a", name: "Main" }]);
  });

  async function openServiceForUser(username: string): Promise<LedgerService> {
    const path = createTempDbPath();
    db = openDatabase(path);
    const user = await new AuthStore(db).createUser(username, USER_PASSWORD);
    return new LedgerService(new LedgerStore(db, user.id));
  }

  function createTempDbPath(): string {
    tempDir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
    return join(tempDir, DB_FILENAME);
  }
});
