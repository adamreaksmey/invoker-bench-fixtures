import type { Account, Transaction } from "../../core/src/ledger";
import { LedgerStore } from "./ledger-store";

/**
 * Domain-facing ledger operations for one authenticated user.
 *
 * The service deliberately knows nothing about HTTP or Express. Persistence is
 * supplied by LedgerStore, while input normalization and ledger invariants are
 * kept here at the service boundary.
 */
export class LedgerService {
  constructor(
    private readonly store: LedgerStore,
    private readonly userId: string,
  ) {}

  addAccount(account: Account): Account {
    const id = requireText(account?.id, "Account id");
    const name = requireText(account?.name, "Account name");
    return this.store.addAccount(this.userId, { id, name });
  }

  getAccount(accountId: string): Account | undefined {
    return this.store.getAccount(this.userId, requireText(accountId, "Account id"));
  }

  listAccounts(): Account[] {
    return this.store.listAccounts(this.userId);
  }

  addTransaction(transaction: Transaction): Transaction {
    const id = requireText(transaction?.id, "Transaction id");
    const accountId = requireText(transaction?.accountId, "Account id");
    if (!Number.isSafeInteger(transaction.amountCents)) {
      throw new TypeError("Transaction amountCents must be a safe integer");
    }
    if (transaction.amountCents === 0) {
      throw new RangeError("Transaction amountCents cannot be zero");
    }
    const description = transaction.description?.trim();
    return this.store.addTransaction(this.userId, {
      id,
      accountId,
      amountCents: transaction.amountCents,
      ...(description ? { description } : {}),
    });
  }

  listTransactions(accountId?: string): Transaction[] {
    return this.store.listTransactions(
      this.userId,
      accountId === undefined ? undefined : requireText(accountId, "Account id"),
    );
  }

  getBalance(accountId: string): number {
    return this.store.getBalance(this.userId, requireText(accountId, "Account id"));
  }
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}
