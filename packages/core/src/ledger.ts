/** An account tracked by the in-memory ledger. */
export interface Account {
  id: string;
  name: string;
}

/** A transaction amount is signed integer cents: credits are positive, debits negative. */
export interface Transaction {
  id: string;
  accountId: string;
  amountCents: number;
  description?: string;
}

export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly transactions: Transaction[] = [];
  private readonly transactionIds = new Set<string>();

  addAccount(account: Account): Account {
    const id = requireText(account?.id, "Account id");
    const name = requireText(account?.name, "Account name");
    if (this.accounts.has(id)) throw new Error(`Account already exists: ${id}`);
    const saved = { id, name };
    this.accounts.set(id, saved);
    return { ...saved };
  }

  getAccount(accountId: string): Account | undefined {
    const account = this.accounts.get(accountId);
    return account ? { ...account } : undefined;
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()].map((account) => ({ ...account }));
  }

  addTransaction(transaction: Transaction): Transaction {
    const id = requireText(transaction?.id, "Transaction id");
    const accountId = requireText(transaction?.accountId, "Account id");
    if (!this.accounts.has(accountId)) throw new Error(`Unknown account: ${accountId}`);
    if (this.transactionIds.has(id)) throw new Error(`Transaction already exists: ${id}`);
    if (!Number.isSafeInteger(transaction.amountCents)) {
      throw new TypeError("Transaction amountCents must be a safe integer");
    }
    if (transaction.amountCents === 0) throw new RangeError("Transaction amountCents cannot be zero");
    const description = transaction.description?.trim();
    const saved: Transaction = {
      id,
      accountId,
      amountCents: transaction.amountCents,
      ...(description ? { description } : {}),
    };
    this.transactions.push(saved);
    this.transactionIds.add(id);
    return { ...saved };
  }

  listTransactions(accountId?: string): Transaction[] {
    if (accountId !== undefined && !this.accounts.has(accountId)) {
      throw new Error(`Unknown account: ${accountId}`);
    }
    return this.transactions
      .filter((transaction) => accountId === undefined || transaction.accountId === accountId)
      .map((transaction) => ({ ...transaction }));
  }

  getBalance(accountId: string): number {
    if (!this.accounts.has(accountId)) throw new Error(`Unknown account: ${accountId}`);
    let balance = 0;
    for (const transaction of this.transactions) {
      if (transaction.accountId !== accountId) continue;
      balance += transaction.amountCents;
      if (!Number.isSafeInteger(balance)) throw new RangeError("Account balance exceeds safe integer cents");
    }
    return balance;
  }
}

export function createLedger(): Ledger {
  return new Ledger();
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}
