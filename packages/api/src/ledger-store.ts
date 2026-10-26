import type { DatabaseSync } from "node:sqlite";
import type { Account, Transaction } from "../../core/src/ledger";

type AccountRow = { id: string; name: string };
type TransactionRow = {
  id: string;
  account_id: string;
  amount_cents: number;
  description: string | null;
};

/** SQLite-backed ledger operations. Every operation is scoped to one user. */
export class LedgerStore {
  constructor(private readonly db: DatabaseSync) {}

  addAccount(userIdInput: unknown, account: Account): Account {
    const userId = requireText(userIdInput, "User id");
    const id = requireText(account?.id, "Account id");
    const name = requireText(account?.name, "Account name");
    if (this.accountExists(userId, id)) throw new Error(`Account already exists: ${id}`);

    this.db.prepare("INSERT INTO accounts (user_id, id, name) VALUES (?, ?, ?)")
      .run(userId, id, name);
    return { id, name };
  }

  getAccount(userIdInput: unknown, accountIdInput: unknown): Account | undefined {
    const userId = requireText(userIdInput, "User id");
    const accountId = requireText(accountIdInput, "Account id");
    const row = this.db.prepare("SELECT id, name FROM accounts WHERE user_id = ? AND id = ?")
      .get(userId, accountId) as AccountRow | undefined;
    return row && { id: row.id, name: row.name };
  }

  listAccounts(userIdInput: unknown): Account[] {
    const userId = requireText(userIdInput, "User id");
    const rows = this.db.prepare("SELECT id, name FROM accounts WHERE user_id = ? ORDER BY rowid")
      .all(userId) as AccountRow[];
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  addTransaction(userIdInput: unknown, transaction: Transaction): Transaction {
    const userId = requireText(userIdInput, "User id");
    const id = requireText(transaction?.id, "Transaction id");
    const accountId = requireText(transaction?.accountId, "Account id");
    if (!this.accountExists(userId, accountId)) throw new Error(`Unknown account: ${accountId}`);
    if (this.transactionExists(userId, id)) throw new Error(`Transaction already exists: ${id}`);
    if (!Number.isSafeInteger(transaction.amountCents)) {
      throw new TypeError("Transaction amountCents must be a safe integer");
    }
    if (transaction.amountCents === 0) throw new RangeError("Transaction amountCents cannot be zero");

    const description = transaction.description?.trim();
    this.db.prepare(
      "INSERT INTO transactions (user_id, id, account_id, amount_cents, description) VALUES (?, ?, ?, ?, ?)",
    ).run(userId, id, accountId, transaction.amountCents, description || null);
    return {
      id,
      accountId,
      amountCents: transaction.amountCents,
      ...(description ? { description } : {}),
    };
  }

  listTransactions(userIdInput: unknown, accountIdInput?: unknown): Transaction[] {
    const userId = requireText(userIdInput, "User id");
    const accountId = accountIdInput === undefined ? undefined : requireText(accountIdInput, "Account id");
    if (accountId !== undefined && !this.accountExists(userId, accountId)) {
      throw new Error(`Unknown account: ${accountId}`);
    }
    const rows = accountId === undefined
      ? this.db.prepare("SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? ORDER BY rowid").all(userId)
      : this.db.prepare("SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid").all(userId, accountId);
    return (rows as TransactionRow[]).map(toTransaction);
  }

  getBalance(userIdInput: unknown, accountIdInput: unknown): number {
    const userId = requireText(userIdInput, "User id");
    const accountId = requireText(accountIdInput, "Account id");
    if (!this.accountExists(userId, accountId)) throw new Error(`Unknown account: ${accountId}`);
    const rows = this.db.prepare("SELECT amount_cents FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid")
      .all(userId, accountId) as Array<{ amount_cents: number }>;
    let balance = 0;
    for (const row of rows) {
      balance += Number(row.amount_cents);
      if (!Number.isSafeInteger(balance)) throw new RangeError("Account balance exceeds safe integer cents");
    }
    return balance;
  }

  private accountExists(userId: string, accountId: string): boolean {
    return this.db.prepare("SELECT 1 AS present FROM accounts WHERE user_id = ? AND id = ?")
      .get(userId, accountId) !== undefined;
  }

  private transactionExists(userId: string, transactionId: string): boolean {
    return this.db.prepare("SELECT 1 AS present FROM transactions WHERE user_id = ? AND id = ?")
      .get(userId, transactionId) !== undefined;
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
