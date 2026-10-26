import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db";
import { LedgerService } from "./ledger-service";
import { LedgerStore } from "./ledger-store";
import type { DatabaseSync } from "node:sqlite";

describe("LedgerService", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => db?.close());

  function createService(): LedgerService {
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run("user-1", "alice", "hash", 1);
    return new LedgerService(new LedgerStore(db), "user-1");
  }

  it("normalizes valid data and exposes account and balance operations", () => {
    const service = createService();
    expect(service.addAccount({ id: " checking ", name: " Checking " })).toEqual({ id: "checking", name: "Checking" });
    expect(service.addTransaction({
      id: " payday ", accountId: " checking ", amountCents: 12550, description: " Pay day ",
    })).toEqual({ id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" });
    expect(service.listAccounts()).toEqual([{ id: "checking", name: "Checking" }]);
    expect(service.listTransactions(" checking ")).toEqual([
      { id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" },
    ]);
    expect(service.getAccount(" checking ")).toEqual({ id: "checking", name: "Checking" });
    expect(service.getBalance(" checking ")).toBe(12550);
  });

  it("enforces validation, unknown-account, and duplicate rules", () => {
    const service = createService();
    service.addAccount({ id: "checking", name: "Checking" });

    expect(() => service.addAccount({ id: " ", name: "Checking" })).toThrow(/Account id.*non-empty/);
    expect(() => service.addAccount({ id: "checking", name: "Other" })).toThrow("Account already exists: checking");
    expect(() => service.addTransaction({ id: "tx", accountId: "missing", amountCents: 1 })).toThrow("Unknown account: missing");
    expect(() => service.addTransaction({ id: "zero", accountId: "checking", amountCents: 0 })).toThrow(/cannot be zero/);
    expect(() => service.addTransaction({ id: "fraction", accountId: "checking", amountCents: 1.5 })).toThrow(/safe integer/);
    service.addTransaction({ id: "tx", accountId: "checking", amountCents: 1 });
    expect(() => service.addTransaction({ id: "tx", accountId: "checking", amountCents: 2 })).toThrow("Transaction already exists: tx");
    expect(() => service.listTransactions("missing")).toThrow("Unknown account: missing");
    expect(() => service.getBalance("missing")).toThrow("Unknown account: missing");
  });
});
