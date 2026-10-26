import type { DatabaseSync } from "node:sqlite";
import type { Account, Transaction } from "../../core/src/ledger";

type AccountRow = { id: string; name: string };
type TransactionRow = {
  id: string;
  account_id: string;
  amount_cents: number;
  description: string | null;
};

/**
 * SQLite-backed ledger operations for one authenticated user.
 * Domain rules match packages/core Ledger (trimmed ids/names, duplicates, safe-integer amounts).
 */
export class LedgerService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly userId: string,
  ) {}

  addAccount(account: Account): Account {
    const id = requireText(account?.id, "Account id");
    const name = requireText(account?.name, "Account name");
    if (this.findAccountRow(id)) throw new Error(`Account already exists: ${id}`);
    this.db.prepare("INSERT INTO accounts (user_id, id, name) VALUES (?, ?, ?)").run(
      this.userId,
      id,
      name,
    );
    return { id, name };
  }

  getAccount(accountId: string): Account | undefined {
    const row = this.findAccountRow(accountId);
    return row ? { id: row.id, name: row.name } : undefined;
  }

  listAccounts(): Account[] {
    const rows = this.db
      .prepare("SELECT id, name FROM accounts WHERE user_id = ? ORDER BY id")
      .all(this.userId) as AccountRow[];
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  addTransaction(transaction: Transaction): Transaction {
    const id = requireText(transaction?.id, "Transaction id");
    const accountId = requireText(transaction?.accountId, "Account id");
    if (!this.findAccountRow(accountId)) throw new Error(`Unknown account: ${accountId}`);
    if (this.findTransactionRow(id)) throw new Error(`Transaction already exists: ${id}`);
    if (!Number.isSafeInteger(transaction.amountCents)) {
      throw new TypeError("Transaction amountCents must be a safe integer");
    }
    if (transaction.amountCents === 0) {
      throw new RangeError("Transaction amountCents cannot be zero");
    }
    const description = transaction.description?.trim();
    this.db
      .prepare(
        `INSERT INTO transactions (user_id, id, account_id, amount_cents, description)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(this.userId, id, accountId, transaction.amountCents, description || null);
    const saved: Transaction = {
      id,
      accountId,
      amountCents: transaction.amountCents,
      ...(description ? { description } : {}),
    };
    return { ...saved };
  }

  listTransactions(accountId?: string): Transaction[] {
    if (accountId !== undefined && !this.findAccountRow(accountId)) {
      throw new Error(`Unknown account: ${accountId}`);
    }
    const rows = (
      accountId === undefined
        ? this.db
            .prepare(
              `SELECT id, account_id, amount_cents, description
               FROM transactions WHERE user_id = ? ORDER BY rowid`,
            )
            .all(this.userId)
        : this.db
            .prepare(
              `SELECT id, account_id, amount_cents, description
               FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid`,
            )
            .all(this.userId, accountId)
    ) as TransactionRow[];
    return rows.map(toTransaction);
  }

  getBalance(accountId: string): number {
    if (!this.findAccountRow(accountId)) throw new Error(`Unknown account: ${accountId}`);
    const row = this.db
      .prepare(
        `SELECT amount_cents AS amountCents FROM transactions
         WHERE user_id = ? AND account_id = ? ORDER BY rowid`,
      )
      .all(this.userId, accountId) as { amountCents: number }[];
    let balance = 0;
    for (const entry of row) {
      balance += Number(entry.amountCents);
      if (!Number.isSafeInteger(balance)) {
        throw new RangeError("Account balance exceeds safe integer cents");
      }
    }
    return balance;
  }

  private findAccountRow(accountId: string): AccountRow | undefined {
    return this.db
      .prepare("SELECT id, name FROM accounts WHERE user_id = ? AND id = ?")
      .get(this.userId, accountId) as AccountRow | undefined;
  }

  private findTransactionRow(transactionId: string): TransactionRow | undefined {
    return this.db
      .prepare(
        `SELECT id, account_id, amount_cents, description
         FROM transactions WHERE user_id = ? AND id = ?`,
      )
      .get(this.userId, transactionId) as TransactionRow | undefined;
  }
}

function toTransaction(row: TransactionRow): Transaction {
  const description = row.description?.trim();
  return {
    id: row.id,
    accountId: row.account_id,
    amountCents: Number(row.amount_cents),
    ...(description ? { description } : {}),
  };
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}
