import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db";
import { LedgerService } from "./ledger-service";

describe("LedgerService", () => {
  let db: DatabaseSync | undefined;
  afterEach(() => db?.close());

  it("persists domain operations while enforcing ledger rules", () => {
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run("alice", "alice", "hash", 0);
    const service = new LedgerService(db);
    service.addAccount("alice", { id: " checking ", name: " Main " });
    expect(service.listAccounts("alice")).toEqual([{ id: "checking", name: "Main" }]);
    expect(service.addTransaction("alice", { id: "pay", accountId: "checking", amountCents: 125, description: "  deposit  " }))
      .toEqual({ id: "pay", accountId: "checking", amountCents: 125, description: "deposit" });
    expect(service.getBalance("alice", "checking")).toBe(125);
    expect(service.listTransactions("alice")).toEqual([{ id: "pay", accountId: "checking", amountCents: 125, description: "deposit" }]);

    expect(() => service.addAccount("alice", { id: "checking", name: "Other" })).toThrow(/already exists/);
    expect(() => service.addTransaction("alice", { id: "missing", accountId: "nope", amountCents: 1 })).toThrow(/Unknown account/);
    expect(() => service.addTransaction("alice", { id: "zero", accountId: "checking", amountCents: 0 })).toThrow(/cannot be zero/);
    expect(() => service.addTransaction("alice", { id: "fraction", accountId: "checking", amountCents: 1.5 })).toThrow(/safe integer/);
  });

  it("scopes accounts and transactions by user", () => {
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run("alice", "alice", "hash", 0);
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run("bob", "bob", "hash", 0);
    const service = new LedgerService(db);
    service.addAccount("alice", { id: "cash", name: "Alice cash" });
    service.addTransaction("alice", { id: "income", accountId: "cash", amountCents: 100 });
    expect(service.listAccounts("bob")).toEqual([]);
    expect(service.listTransactions("bob")).toEqual([]);
    expect(() => service.getBalance("bob", "cash")).toThrow(/Unknown account/);
  });
});
