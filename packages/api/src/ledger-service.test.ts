import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { AuthStore } from "./auth-store";
import { openDatabase } from "./db";
import { LedgerService } from "./ledger-service";

describe("LedgerService", () => {
  let db: DatabaseSync | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  async function serviceFor(username: string): Promise<LedgerService> {
    db = openDatabase(":memory:");
    const auth = new AuthStore(db);
    const user = await auth.createUser(username, "passphrase");
    return new LedgerService(db, user.id);
  }

  it("creates accounts and computes balances from signed integer cents", async () => {
    const ledger = await serviceFor("alice");
    ledger.addAccount({ id: "checking", name: "Checking" });
    ledger.addAccount({ id: "savings", name: "Savings" });
    ledger.addTransaction({ id: "pay", accountId: "checking", amountCents: 125_050 });
    ledger.addTransaction({ id: "rent", accountId: "checking", amountCents: -80_025 });
    ledger.addTransaction({ id: "transfer", accountId: "savings", amountCents: 10_000 });

    expect(ledger.getBalance("checking")).toBe(45_025);
    expect(ledger.getBalance("savings")).toBe(10_000);
    expect(ledger.listTransactions("checking").map(({ id }) => id)).toEqual(["pay", "rent"]);
    expect(ledger.listAccounts()).toEqual([
      { id: "checking", name: "Checking" },
      { id: "savings", name: "Savings" },
    ]);
  });

  it("does not expose mutable internal records and trims descriptions", async () => {
    const ledger = await serviceFor("bob");
    const account = ledger.addAccount({ id: "a", name: "Main" });
    account.name = "Changed";
    ledger.addTransaction({ id: "t", accountId: "a", amountCents: 1, description: "  deposit  " });
    const transactions = ledger.listTransactions();
    transactions[0].amountCents = 50;
    expect(ledger.getAccount("a")?.name).toBe("Main");
    expect(ledger.getBalance("a")).toBe(1);
    expect(ledger.listTransactions()[0].description).toBe("deposit");
  });

  it("rejects duplicate ids, missing accounts, and invalid amounts", async () => {
    const ledger = await serviceFor("carol");
    ledger.addAccount({ id: "a", name: "Main" });
    expect(() => ledger.addAccount({ id: "a", name: "Other" })).toThrow(/already exists/);
    expect(() => ledger.addTransaction({ id: "t", accountId: "missing", amountCents: 1 })).toThrow(
      /Unknown account/,
    );
    expect(() => ledger.addTransaction({ id: "t", accountId: "a", amountCents: 0 })).toThrow(
      /cannot be zero/,
    );
    expect(() => ledger.addTransaction({ id: "t", accountId: "a", amountCents: 1.5 })).toThrow(
      /safe integer/,
    );
    expect(() =>
      ledger.addTransaction({ id: "t", accountId: "a", amountCents: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(/safe integer/);
    ledger.addTransaction({ id: "t", accountId: "a", amountCents: 1 });
    expect(() => ledger.addTransaction({ id: "t", accountId: "a", amountCents: 2 })).toThrow(
      /already exists/,
    );
    expect(ledger.getBalance("a")).toBe(1);
  });

  it("rejects unknown balance and transaction queries", async () => {
    const ledger = await serviceFor("dave");
    expect(() => ledger.getBalance("missing")).toThrow(/Unknown account/);
    expect(() => ledger.listTransactions("missing")).toThrow(/Unknown account/);
  });

  it("rejects a balance that overflows safe integer cents", async () => {
    const ledger = await serviceFor("erin");
    ledger.addAccount({ id: "a", name: "Main" });
    ledger.addTransaction({ id: "large", accountId: "a", amountCents: Number.MAX_SAFE_INTEGER });
    ledger.addTransaction({ id: "overflow", accountId: "a", amountCents: 1 });
    expect(() => ledger.getBalance("a")).toThrow(/exceeds safe integer/);
  });

  it("scopes accounts and transactions to the owning user", async () => {
    db = openDatabase(":memory:");
    const auth = new AuthStore(db);
    const alice = await auth.createUser("alice", "passphrase");
    const bob = await auth.createUser("bob", "passphrase");
    const aliceLedger = new LedgerService(db, alice.id);
    const bobLedger = new LedgerService(db, bob.id);

    aliceLedger.addAccount({ id: "checking", name: "Alice checking" });
    aliceLedger.addTransaction({ id: "pay", accountId: "checking", amountCents: 500 });
    bobLedger.addAccount({ id: "checking", name: "Bob checking" });

    expect(bobLedger.listAccounts()).toEqual([{ id: "checking", name: "Bob checking" }]);
    expect(bobLedger.listTransactions()).toEqual([]);
    expect(aliceLedger.getBalance("checking")).toBe(500);
    expect(bobLedger.getBalance("checking")).toBe(0);
  });
});
