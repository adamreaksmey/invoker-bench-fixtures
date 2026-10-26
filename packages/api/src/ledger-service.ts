import type { DatabaseSync } from "node:sqlite";

export interface Account { id: string; name: string }
export interface Transaction { id: string; accountId: string; amountCents: number; description?: string }

type AccountRow = { id: string; name: string };
type TransactionRow = { id: string; account_id: string; amount_cents: number; description: string | null };

/** Persistent ledger domain operations. This service has no HTTP/Express dependency. */
export class LedgerService {
  constructor(private readonly db: DatabaseSync) {}

  addAccount(userId: string, input: Account): Account {
    const id = requireText(input?.id, "Account id");
    const name = requireText(input?.name, "Account name");
    try {
      this.db.prepare("INSERT INTO accounts (user_id, id, name) VALUES (?, ?, ?)").run(userId, id, name);
    } catch (error) {
      if (isConstraint(error)) throw new Error(`Account already exists: ${id}`);
      throw error;
    }
    return { id, name };
  }

  listAccounts(userId: string): Account[] {
    const rows = this.db.prepare("SELECT id, name FROM accounts WHERE user_id = ? ORDER BY rowid").all(userId) as unknown as AccountRow[];
    return rows.map(row => ({ id: row.id, name: row.name }));
  }

  addTransaction(userId: string, input: Transaction): Transaction {
    const id = requireText(input?.id, "Transaction id");
    const accountId = requireText(input?.accountId, "Account id");
    if (!this.hasAccount(userId, accountId)) throw new Error(`Unknown account: ${accountId}`);
    if (!Number.isSafeInteger(input.amountCents)) throw new TypeError("Transaction amountCents must be a safe integer");
    if (input.amountCents === 0) throw new RangeError("Transaction amountCents cannot be zero");
    if (input.description !== undefined && typeof input.description !== "string") {
      throw new TypeError("Transaction description must be a string");
    }
    const description = input.description?.trim();
    try {
      this.db.prepare("INSERT INTO transactions (user_id, id, account_id, amount_cents, description) VALUES (?, ?, ?, ?, ?)")
        .run(userId, id, accountId, input.amountCents, description || null);
    } catch (error) {
      if (isConstraint(error)) throw new Error(`Transaction already exists: ${id}`);
      throw error;
    }
    return { id, accountId, amountCents: input.amountCents, ...(description ? { description } : {}) };
  }

  listTransactions(userId: string, accountId?: string): Transaction[] {
    if (accountId !== undefined) {
      const normalizedAccountId = requireText(accountId, "Account id");
      if (!this.hasAccount(userId, normalizedAccountId)) throw new Error(`Unknown account: ${normalizedAccountId}`);
      accountId = normalizedAccountId;
    }
    const rows = (accountId === undefined
      ? this.db.prepare("SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? ORDER BY rowid").all(userId)
      : this.db.prepare("SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid").all(userId, accountId)) as unknown as TransactionRow[];
    return rows.map(toTransaction);
  }

  getBalance(userId: string, accountId: string): number {
    const normalized = requireText(accountId, "Account id");
    if (!this.hasAccount(userId, normalized)) throw new Error(`Unknown account: ${normalized}`);
    const rows = this.db.prepare("SELECT amount_cents FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid").all(userId, normalized) as unknown as Array<{ amount_cents: number }>;
    let balance = 0;
    for (const row of rows) {
      balance += Number(row.amount_cents);
      if (!Number.isSafeInteger(balance)) throw new RangeError("Account balance exceeds safe integer cents");
    }
    return balance;
  }

  private hasAccount(userId: string, accountId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM accounts WHERE user_id = ? AND id = ?").get(userId, accountId));
  }
}

function toTransaction(row: TransactionRow): Transaction {
  return { id: row.id, accountId: row.account_id, amountCents: Number(row.amount_cents), ...(row.description ? { description: row.description } : {}) };
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function isConstraint(error: unknown): boolean { return error instanceof Error && /UNIQUE constraint failed/.test(error.message); }
