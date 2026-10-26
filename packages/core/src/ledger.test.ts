import { describe, expect, it } from "vitest";
import { Ledger, createLedger } from "./ledger";

describe("Ledger", () => {
  it("creates accounts and computes balances from signed integer cents", () => {
    const ledger = createLedger();
    ledger.addAccount({ id: "checking", name: "Checking" });
    ledger.addAccount({ id: "savings", name: "Savings" });
    ledger.addTransaction({ id: "pay", accountId: "checking", amountCents: 125_050 });
    ledger.addTransaction({ id: "rent", accountId: "checking", amountCents: -80_025 });
    ledger.addTransaction({ id: "transfer", accountId: "savings", amountCents: 10_000 });

    expect(ledger.getBalance("checking")).toBe(45_025);
    expect(ledger.getBalance("savings")).toBe(10_000);
    expect(ledger.listTransactions("checking").map(({ id }) => id)).toEqual(["pay", "rent"]);
  });

  it("does not expose mutable internal records", () => {
    const ledger = new Ledger();
    const account = ledger.addAccount({ id: "a", name: "Main" });
    account.name = "Changed";
    ledger.addTransaction({ id: "t", accountId: "a", amountCents: 1, description: "  deposit  " });
    const transactions = ledger.listTransactions();
    transactions[0].amountCents = 50;
    expect(ledger.getAccount("a")?.name).toBe("Main");
    expect(ledger.getBalance("a")).toBe(1);
    expect(ledger.listTransactions()[0].description).toBe("deposit");
  });

  it("rejects duplicate ids, missing accounts, and invalid amounts", () => {
    const ledger = new Ledger();
    ledger.addAccount({ id: "a", name: "Main" });
    expect(() => ledger.addAccount({ id: "a", name: "Other" })).toThrow(/already exists/);
    expect(() => ledger.addTransaction({ id: "t", accountId: "missing", amountCents: 1 })).toThrow(/Unknown account/);
    expect(() => ledger.addTransaction({ id: "t", accountId: "a", amountCents: 0 })).toThrow(/cannot be zero/);
    expect(() => ledger.addTransaction({ id: "t", accountId: "a", amountCents: 1.5 })).toThrow(/safe integer/);
    expect(() => ledger.addTransaction({ id: "t", accountId: "a", amountCents: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/safe integer/);
    ledger.addTransaction({ id: "t", accountId: "a", amountCents: 1 });
    expect(() => ledger.addTransaction({ id: "t", accountId: "a", amountCents: 2 })).toThrow(/already exists/);
    expect(ledger.getBalance("a")).toBe(1);
  });

  it("rejects unknown balance and transaction queries", () => {
    const ledger = new Ledger();
    expect(() => ledger.getBalance("missing")).toThrow(/Unknown account/);
    expect(() => ledger.listTransactions("missing")).toThrow(/Unknown account/);
  });

  it("rejects a balance that overflows safe integer cents", () => {
    const ledger = new Ledger();
    ledger.addAccount({ id: "a", name: "Main" });
    ledger.addTransaction({ id: "large", accountId: "a", amountCents: Number.MAX_SAFE_INTEGER });
    ledger.addTransaction({ id: "overflow", accountId: "a", amountCents: 1 });
    expect(() => ledger.getBalance("a")).toThrow(/exceeds safe integer/);
  });
});
