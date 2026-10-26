import type { Account, Transaction } from "../../core/src/ledger";
import type { LedgerStore } from "./ledger-store";

/** Domain operations for a user's persisted ledger. */
export class LedgerService {
  constructor(private readonly store: LedgerPersistence) {}

  addAccount(userId: string, account: Account): Account {
    const id = requireText(account?.id, "Account id");
    const name = requireText(account?.name, "Account name");
    return this.store.addAccount(userId, { id, name });
  }

  listAccounts(userId: string): Account[] {
    return this.store.listAccounts(userId);
  }

  addTransaction(userId: string, transaction: Transaction): Transaction {
    const id = requireText(transaction?.id, "Transaction id");
    const accountId = requireText(transaction?.accountId, "Account id");
    if (!Number.isSafeInteger(transaction?.amountCents)) {
      throw new TypeError("Transaction amountCents must be a safe integer");
    }
    if (transaction.amountCents === 0) {
      throw new RangeError("Transaction amountCents cannot be zero");
    }
    const description = transaction.description?.trim();
    return this.store.addTransaction(userId, {
      id,
      accountId,
      amountCents: transaction.amountCents,
      ...(description ? { description } : {}),
    });
  }

  listTransactions(userId: string, accountId?: string): Transaction[] {
    return this.store.listTransactions(userId, accountId === undefined ? undefined : requireText(accountId, "Account id"));
  }

  getBalance(userId: string, accountId: string): number {
    return this.store.getBalance(userId, requireText(accountId, "Account id"));
  }
}

export function createLedgerService(store: LedgerStore): LedgerService {
  return new LedgerService(store);
}

type LedgerPersistence = Pick<LedgerStore, "addAccount" | "listAccounts" | "addTransaction" | "listTransactions" | "getBalance">;

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}
