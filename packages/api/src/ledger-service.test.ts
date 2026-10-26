import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./db";
import { LedgerStore } from "./ledger-store";
import { LedgerService } from "./ledger-service";

describe("LedgerService", () => {
  let db: DatabaseSync | undefined;
  let directory: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function setup() {
    directory = mkdtempSync(join(tmpdir(), "ledger-service-"));
    db = openDatabase(join(directory, "ledger.sqlite"));
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run("user-a", "alice", "hash", 1);
    return new LedgerService(new LedgerStore(db));
  }

  it("normalizes persisted ledger operations and computes balances", () => {
    const service = setup();

    expect(service.addAccount("user-a", { id: " checking ", name: " Main checking " }))
      .toEqual({ id: "checking", name: "Main checking" });
    expect(service.addTransaction("user-a", {
      id: " deposit ", accountId: " checking ", amountCents: 12550, description: " pay ",
    })).toEqual({ id: "deposit", accountId: "checking", amountCents: 12550, description: "pay" });
    expect(service.listAccounts("user-a")).toEqual([{ id: "checking", name: "Main checking" }]);
    expect(service.listTransactions("user-a", " checking ")).toEqual([
      { id: "deposit", accountId: "checking", amountCents: 12550, description: "pay" },
    ]);
    expect(service.getBalance("user-a", " checking ")).toBe(12550);
  });

  it("keeps domain validation and duplicate and unknown-account errors", () => {
    const service = setup();
    service.addAccount("user-a", { id: "a", name: "Main" });

    expect(() => service.addAccount("user-a", { id: " a ", name: "Again" }))
      .toThrow("Account already exists: a");
    expect(() => service.addAccount("user-a", { id: "  ", name: "Invalid" })).toThrow(TypeError);
    expect(() => service.addTransaction("user-a", { id: "missing", accountId: "unknown", amountCents: 1 }))
      .toThrow("Unknown account: unknown");
    expect(() => service.addTransaction("user-a", { id: "zero", accountId: "a", amountCents: 0 }))
      .toThrow(RangeError);
    expect(() => service.addTransaction("user-a", {
      id: "unsafe", accountId: "a", amountCents: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow(TypeError);

    service.addTransaction("user-a", { id: "t", accountId: "a", amountCents: 1 });
    expect(() => service.addTransaction("user-a", { id: "t", accountId: "a", amountCents: 2 }))
      .toThrow("Transaction already exists: t");
    expect(() => service.listTransactions("user-a", "missing")).toThrow("Unknown account: missing");
    expect(() => service.getBalance("user-a", "missing")).toThrow("Unknown account: missing");
  });
});
