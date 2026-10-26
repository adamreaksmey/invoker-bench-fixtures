import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db";
import { LedgerStore } from "./ledger-store";
import type { DatabaseSync } from "node:sqlite";

describe("LedgerStore", () => {
  let db: DatabaseSync | undefined;
  let directory: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function setup() {
    directory = mkdtempSync(join(tmpdir(), "ledger-store-"));
    const filename = join(directory, "ledger.sqlite");
    db = openDatabase(filename);
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run("user-a", "alice", "hash", 1);
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run("user-b", "bob", "hash", 1);
    return { filename, store: new LedgerStore(db, () => 100) };
  }

  it("persists accounts and transactions in integer cents across database handles", () => {
    const { filename, store } = setup();
    store.addAccount("user-a", { id: " checking ", name: " Main checking " });
    store.addTransaction("user-a", { id: " t1 ", accountId: "checking", amountCents: 12550, description: " pay " });
    store.addTransaction("user-a", { id: "t2", accountId: "checking", amountCents: -250 });

    expect(store.listAccounts("user-a")).toEqual([{ id: "checking", name: "Main checking" }]);
    expect(store.listTransactions("user-a")).toEqual([
      { id: "t1", accountId: "checking", amountCents: 12550, description: "pay" },
      { id: "t2", accountId: "checking", amountCents: -250 },
    ]);
    expect(store.listTransactions("user-a", "checking")).toHaveLength(2);
    expect(store.getBalance("user-a", "checking")).toBe(12300);
    const transactions = store.listTransactions("user-a");

    db!.close();
    db = openDatabase(filename);
    const reopened = new LedgerStore(db);
    expect(reopened.listAccounts("user-a")).toEqual([{ id: "checking", name: "Main checking" }]);
    expect(reopened.listTransactions("user-a")).toEqual(transactions);
    expect(reopened.getBalance("user-a", "checking")).toBe(12300);
  });

  it("isolates accounts and transactions by user id", () => {
    const { store } = setup();
    store.addAccount("user-a", { id: "cash", name: "Cash" });
    store.addAccount("user-b", { id: "cash", name: "Other cash" });
    store.addTransaction("user-a", { id: "same", accountId: "cash", amountCents: 100 });
    store.addTransaction("user-b", { id: "same", accountId: "cash", amountCents: 900 });

    expect(store.listAccounts("user-b")).toEqual([{ id: "cash", name: "Other cash" }]);
    expect(store.listTransactions("user-b")).toEqual([{ id: "same", accountId: "cash", amountCents: 900 }]);
    expect(store.getBalance("user-a", "cash")).toBe(100);
    expect(store.getBalance("user-b", "cash")).toBe(900);
    expect(() => store.addTransaction("user-a", { id: "bad", accountId: "missing", amountCents: 1 }))
      .toThrow("Unknown account: missing");
  });

  it("keeps ledger validation and duplicate rules", () => {
    const { store } = setup();
    store.addAccount("user-a", { id: "a", name: "A" });
    expect(() => store.addAccount("user-a", { id: " a ", name: "Again" })).toThrow("Account already exists: a");
    expect(() => store.addAccount("user-a", { id: "  ", name: "Invalid" })).toThrow(TypeError);
    store.addTransaction("user-a", { id: "t", accountId: "a", amountCents: 1 });
    expect(() => store.addTransaction("user-a", { id: "t", accountId: "a", amountCents: 2 }))
      .toThrow("Transaction already exists: t");
    expect(() => store.addTransaction("user-a", { id: "zero", accountId: "a", amountCents: 0 })).toThrow(RangeError);
    expect(() => store.addTransaction("user-a", { id: "float", accountId: "a", amountCents: 0.5 })).toThrow(TypeError);
    expect(() => store.getBalance("user-b", "a")).toThrow("Unknown account: a");
  });
});
