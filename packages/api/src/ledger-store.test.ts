import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db";
import { LedgerStore } from "./ledger-store";

describe("LedgerStore", () => {
  let db: DatabaseSync | undefined;
  let directory: string | undefined;

  afterEach(() => {
    db?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("persists accounts and transactions in a file database", () => {
    directory = mkdtempSync(join(tmpdir(), "personal-ledger-"));
    const filename = join(directory, "ledger.sqlite");
    db = openDatabase(filename);
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run("user-1", "alice", "hash", 1);
    const store = new LedgerStore(db);

    expect(store.addAccount("user-1", { id: " checking ", name: " Checking " })).toEqual({ id: "checking", name: "Checking" });
    expect(store.addTransaction("user-1", {
      id: "payday", accountId: "checking", amountCents: 12550, description: "  Pay day  ",
    })).toEqual({ id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" });
    db.close();
    db = openDatabase(filename);

    const reopened = new LedgerStore(db);
    expect(reopened.listAccounts("user-1")).toEqual([{ id: "checking", name: "Checking" }]);
    expect(reopened.listTransactions("user-1")).toEqual([
      { id: "payday", accountId: "checking", amountCents: 12550, description: "Pay day" },
    ]);
    expect(reopened.getBalance("user-1", "checking")).toBe(12550);
  });

  it("isolates accounts and transactions by user id", () => {
    db = openDatabase(":memory:");
    for (const [id, username] of [["user-1", "alice"], ["user-2", "bob"]]) {
      db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
        .run(id, username, "hash", 1);
    }
    const store = new LedgerStore(db);
    store.addAccount("user-1", { id: "checking", name: "Alice checking" });
    store.addAccount("user-2", { id: "checking", name: "Bob checking" });
    store.addTransaction("user-1", { id: "same-id", accountId: "checking", amountCents: 100 });
    store.addTransaction("user-2", { id: "same-id", accountId: "checking", amountCents: -25 });

    expect(store.listAccounts("user-1")).toEqual([{ id: "checking", name: "Alice checking" }]);
    expect(store.listTransactions("user-2")).toEqual([{ id: "same-id", accountId: "checking", amountCents: -25 }]);
    expect(store.getBalance("user-1", "checking")).toBe(100);
    expect(store.getBalance("user-2", "checking")).toBe(-25);
    expect(() => store.getBalance("user-1", "missing")).toThrow("Unknown account: missing");
  });

  it("keeps ledger validation and duplicate rules", () => {
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run("user-1", "alice", "hash", 1);
    const store = new LedgerStore(db);
    store.addAccount("user-1", { id: "checking", name: "Checking" });

    expect(() => store.addAccount("user-1", { id: "checking", name: "Other" })).toThrow("Account already exists: checking");
    expect(() => store.addTransaction("user-1", { id: "bad", accountId: "checking", amountCents: 0 })).toThrow(/cannot be zero/);
    expect(() => store.addTransaction("user-1", { id: "bad", accountId: "checking", amountCents: 1.5 })).toThrow(/safe integer/);
    expect(() => store.addTransaction("user-1", { id: "bad", accountId: "missing", amountCents: 1 })).toThrow("Unknown account: missing");
    store.addTransaction("user-1", { id: "tx", accountId: "checking", amountCents: 1 });
    expect(() => store.addTransaction("user-1", { id: "tx", accountId: "checking", amountCents: 2 })).toThrow("Transaction already exists: tx");
  });
});
