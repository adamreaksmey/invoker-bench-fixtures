import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AuthStore } from "./auth-store";
import { openDatabase } from "./db";
import { LedgerStore } from "./ledger-store";

const TEMP_DIR_PREFIX = "ledger-store-";
const DB_FILENAME = "ledger.sqlite";
const USER_PASSWORD = "passphrase-for-tests";

describe("LedgerStore", () => {
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

  it("persists accounts and transactions as integer cents for one user", async () => {
    const { store } = await openStoreForUser("alice");
    store.addAccount({ id: "checking", name: "Checking" });
    store.addTransaction({ id: "pay", accountId: "checking", amountCents: 125_050, description: " paycheck " });
    store.addTransaction({ id: "rent", accountId: "checking", amountCents: -80_025 });

    expect(store.listAccounts()).toEqual([{ id: "checking", name: "Checking" }]);
    expect(store.listTransactions("checking")).toEqual([
      { id: "pay", accountId: "checking", amountCents: 125_050, description: "paycheck" },
      { id: "rent", accountId: "checking", amountCents: -80_025 },
    ]);
    expect(store.getBalance("checking")).toBe(45_025);
  });

  it("reloads persisted ledger data from the same database file", async () => {
    const path = createTempDbPath();
    const firstDb = openDatabase(path);
    const auth = new AuthStore(firstDb);
    const user = await auth.createUser("reload_user", USER_PASSWORD);
    const firstStore = new LedgerStore(firstDb, user.id);
    firstStore.addAccount({ id: "savings", name: "Savings" });
    firstStore.addTransaction({ id: "deposit", accountId: "savings", amountCents: 10_000 });
    firstDb.close();

    db = openDatabase(path);
    const reloaded = new LedgerStore(db, user.id);
    expect(reloaded.listAccounts()).toEqual([{ id: "savings", name: "Savings" }]);
    expect(reloaded.getBalance("savings")).toBe(10_000);
  });

  it("scopes accounts and transactions per user id", async () => {
    const path = createTempDbPath();
    db = openDatabase(path);
    const auth = new AuthStore(db);
    const alice = await auth.createUser("alice_scope", USER_PASSWORD);
    const bob = await auth.createUser("bob_scope", USER_PASSWORD);
    const aliceStore = new LedgerStore(db, alice.id);
    const bobStore = new LedgerStore(db, bob.id);

    aliceStore.addAccount({ id: "shared-id", name: "Alice Checking" });
    aliceStore.addTransaction({ id: "t1", accountId: "shared-id", amountCents: 5_000 });
    bobStore.addAccount({ id: "shared-id", name: "Bob Checking" });
    bobStore.addTransaction({ id: "t1", accountId: "shared-id", amountCents: -2_500 });

    expect(aliceStore.getBalance("shared-id")).toBe(5_000);
    expect(bobStore.getBalance("shared-id")).toBe(-2_500);
    expect(aliceStore.listAccounts()[0].name).toBe("Alice Checking");
    expect(bobStore.listAccounts()[0].name).toBe("Bob Checking");
  });

  it("rejects duplicates, unknown accounts, and invalid amounts", async () => {
    const { store } = await openStoreForUser("validator");
    store.addAccount({ id: "a", name: "Main" });

    expect(() => store.addAccount({ id: "a", name: "Other" })).toThrow(/already exists/);
    expect(() => store.addTransaction({ id: "t", accountId: "missing", amountCents: 1 })).toThrow(/Unknown account/);
    expect(() => store.addTransaction({ id: "t", accountId: "a", amountCents: 0 })).toThrow(/cannot be zero/);
    expect(() => store.addTransaction({ id: "t", accountId: "a", amountCents: 1.5 })).toThrow(/safe integer/);
    store.addTransaction({ id: "t", accountId: "a", amountCents: 1 });
    expect(() => store.addTransaction({ id: "t", accountId: "a", amountCents: 2 })).toThrow(/already exists/);
    expect(() => store.getBalance("missing")).toThrow(/Unknown account/);
    expect(() => store.listTransactions("missing")).toThrow(/Unknown account/);
  });

  async function openStoreForUser(username: string): Promise<{ store: LedgerStore }> {
    const path = createTempDbPath();
    db = openDatabase(path);
    const user = await new AuthStore(db).createUser(username, USER_PASSWORD);
    return { store: new LedgerStore(db, user.id) };
  }

  function createTempDbPath(): string {
    tempDir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
    return join(tempDir, DB_FILENAME);
  }
});
