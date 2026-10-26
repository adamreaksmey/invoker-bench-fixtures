import type { Account, Transaction } from "../../core/src/ledger";
import type { LedgerStore } from "./ledger-store";

const ZERO_CENTS = 0;

/**
 * Domain service over persisted ledger storage.
 * Same rules as packages/core Ledger; no Express dependency.
 */
export class LedgerService {
  constructor(private readonly store: LedgerStore) {}

  addAccount(account: Account): Account {
    const id = requireText(account?.id, "Account id");
    const name = requireText(account?.name, "Account name");
    if (this.store.getAccount(id)) throw new Error(`Account already exists: ${id}`);
    return this.store.addAccount({ id, name });
  }

  getAccount(accountId: string): Account | undefined {
    return this.store.getAccount(accountId);
  }

  listAccounts(): Account[] {
    return this.store.listAccounts();
  }

  addTransaction(transaction: Transaction): Transaction {
    const id = requireText(transaction?.id, "Transaction id");
    const accountId = requireText(transaction?.accountId, "Account id");
    requireKnownAccount(this.store, accountId);
    requireUniqueTransactionId(this.store, id);
    requireSafeNonZeroCents(transaction.amountCents);
    const description = transaction.description?.trim();
    return this.store.addTransaction({
      id,
      accountId,
      amountCents: transaction.amountCents,
      ...(description ? { description } : {}),
    });
  }

  listTransactions(accountId?: string): Transaction[] {
    if (accountId !== undefined) {
      requireKnownAccount(this.store, requireText(accountId, "Account id"));
    }
    return this.store.listTransactions(accountId);
  }

  getBalance(accountId: string): number {
    const id = requireText(accountId, "Account id");
    requireKnownAccount(this.store, id);
    return this.store.getBalance(id);
  }
}

export function createLedgerService(store: LedgerStore): LedgerService {
  return new LedgerService(store);
}

function requireKnownAccount(store: LedgerStore, accountId: string): void {
  if (!store.getAccount(accountId)) throw new Error(`Unknown account: ${accountId}`);
}

function requireUniqueTransactionId(store: LedgerStore, id: string): void {
  const existing = store.listTransactions().some((transaction) => transaction.id === id);
  if (existing) throw new Error(`Transaction already exists: ${id}`);
}

function requireSafeNonZeroCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents)) {
    throw new TypeError("Transaction amountCents must be a safe integer");
  }
  if (amountCents === ZERO_CENTS) {
    throw new RangeError("Transaction amountCents cannot be zero");
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}
