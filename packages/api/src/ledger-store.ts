import type { DatabaseSync } from "node:sqlite";
import type { Account, Transaction } from "../../core/src/ledger";

type AccountRow = { id: string; name: string };
type TransactionRow = { id: string; account_id: string; amount_cents: number; description: string | null };

/** SQLite-backed ledger persistence. Every query is scoped to its owning user. */
export class LedgerStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}

  addAccount(userId: string, input: Account): Account {
    const owner = requireText(userId, "User id");
    const id = requireText(input?.id, "Account id");
    const name = requireText(input?.name, "Account name");
    try {
      this.db.prepare("INSERT INTO accounts (user_id, id, name, created_at) VALUES (?, ?, ?, ?)")
        .run(owner, id, name, this.now());
    } catch (error) {
      if (isConstraintError(error)) throw new Error(`Account already exists: ${id}`);
      throw error;
    }
    return { id, name };
  }

  listAccounts(userId: string): Account[] {
    const rows = this.db.prepare("SELECT id, name FROM accounts WHERE user_id = ? ORDER BY rowid")
      .all(requireText(userId, "User id")) as AccountRow[];
    return rows.map(({ id, name }) => ({ id, name }));
  }

  addTransaction(userId: string, input: Transaction): Transaction {
    const owner = requireText(userId, "User id");
    const id = requireText(input?.id, "Transaction id");
    const accountId = requireText(input?.accountId, "Account id");
    if (!Number.isSafeInteger(input?.amountCents)) {
      throw new TypeError("Transaction amountCents must be a safe integer");
    }
    if (input.amountCents === 0) throw new RangeError("Transaction amountCents cannot be zero");
    if (!this.db.prepare("SELECT 1 AS found FROM accounts WHERE user_id = ? AND id = ?").get(owner, accountId)) {
      throw new Error(`Unknown account: ${accountId}`);
    }
    const description = input.description?.trim();
    try {
      this.db.prepare(`INSERT INTO transactions
        (user_id, id, account_id, amount_cents, description, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(owner, id, accountId, input.amountCents, description || null, this.now());
    } catch (error) {
      if (isConstraintError(error)) throw new Error(`Transaction already exists: ${id}`);
      throw error;
    }
    return { id, accountId, amountCents: input.amountCents, ...(description ? { description } : {}) };
  }

  listTransactions(userId: string, accountId?: string): Transaction[] {
    const owner = requireText(userId, "User id");
    if (accountId !== undefined) {
      accountId = requireText(accountId, "Account id");
      if (!this.db.prepare("SELECT 1 AS found FROM accounts WHERE user_id = ? AND id = ?").get(owner, accountId)) {
        throw new Error(`Unknown account: ${accountId}`);
      }
    }
    const rows = (accountId === undefined
      ? this.db.prepare(`SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? ORDER BY rowid`).all(owner)
      : this.db.prepare(`SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid`).all(owner, accountId)) as TransactionRow[];
    return rows.map(toTransaction);
  }

  getBalance(userId: string, accountId: string): number {
    const owner = requireText(userId, "User id");
    const account = requireText(accountId, "Account id");
    if (!this.db.prepare("SELECT 1 AS found FROM accounts WHERE user_id = ? AND id = ?").get(owner, account)) {
      throw new Error(`Unknown account: ${account}`);
    }
    let balance = 0;
    const rows = this.db.prepare("SELECT amount_cents FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid")
      .all(owner, account) as Array<{ amount_cents: number }>;
    for (const row of rows) {
      balance += Number(row.amount_cents);
      if (!Number.isSafeInteger(balance)) throw new RangeError("Account balance exceeds safe integer cents");
    }
    return balance;
  }
}

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    amountCents: Number(row.amount_cents),
    ...(row.description ? { description: row.description } : {}),
  };
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint/i.test(error.message);
}
