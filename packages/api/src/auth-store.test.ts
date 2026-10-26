import { afterEach, describe, expect, it } from "vitest";
import { AuthStore } from "./auth-store";
import { openDatabase } from "./db";
import type { DatabaseSync } from "node:sqlite";

describe("AuthStore", () => {
  let db: DatabaseSync | undefined;
  afterEach(() => db?.close());

  it("persists users with password hashes and authenticates credentials", async () => {
    db = openDatabase(":memory:");
    const store = new AuthStore(db, () => 1000);
    const created = await store.createUser("Alice_1", "correct horse");

    expect(created.username).toBe("alice_1");
    expect(created.passwordHash).not.toContain("correct horse");
    expect(store.findUserByUsername("ALICE_1")).toEqual(created);
    expect(await store.authenticate("alice_1", "correct horse")).toEqual(created);
    expect(await store.authenticate("alice_1", "wrong password")).toBeUndefined();
  });

  it("uses parameterized statements for usernames and validates malicious input", async () => {
    db = openDatabase(":memory:");
    const store = new AuthStore(db);
    await store.createUser("ledger_user", "passphrase");

    expect(() => store.findUserByUsername("' OR 1=1 --")).toThrow(TypeError);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toMatchObject({ count: 1 });
  });

  it("creates, expires, deletes, and cascades sessions safely", async () => {
    db = openDatabase(":memory:");
    let now = 5000;
    const store = new AuthStore(db, () => now);
    const user = await store.createUser("session_user", "passphrase");
    const session = store.createSession(user.id, 100);

    expect(store.findSession(session.token)).toEqual(session);
    expect(store.deleteSession(session.token)).toBe(true);
    expect(store.findSession(session.token)).toBeUndefined();

    const expiring = store.createSession(user.id, 100);
    now = 5100;
    expect(store.findSession(expiring.token)).toBeUndefined();
    expect(store.deleteExpiredSessions()).toBe(1);
    expect(() => store.createSession(user.id, 0)).toThrow(RangeError);

    const cascaded = store.createSession(user.id, 100);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    expect(store.findSession(cascaded.token)).toBeUndefined();
  });
});
