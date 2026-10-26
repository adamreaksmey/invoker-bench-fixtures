import type { DatabaseSync } from "node:sqlite";
import type { Account, Transaction } from "../../core/src/ledger";

type AccountRow = { id: string; name: string };
type TransactionRow = {
  id: string;
  account_id: string;
  amount_cents: number | bigint;
  description: string | null;
};

const CONSTRAINT_FAILED = "constraint failed";
const ZERO_CENTS = 0;

/** SQLite-backed ledger storage scoped to a single user. Amounts stay integer cents. */
export class LedgerStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly userId: string,
  ) {
    requireText(userId, "User id");
  }

  addAccount(account: Account): Account {
    const id = requireText(account?.id, "Account id");
    const name = requireText(account?.name, "Account name");
    try {
      this.db.prepare("INSERT INTO accounts (user_id, id, name) VALUES (?, ?, ?)").run(this.userId, id, name);
    } catch (error) {
      throwIfDuplicateAccount(error, id);
      throw error;
    }
    return { id, name };
  }

  getAccount(accountId: string): Account | undefined {
    const id = requireText(accountId, "Account id");
    const row = this.db
      .prepare("SELECT id, name FROM accounts WHERE user_id = ? AND id = ?")
      .get(this.userId, id) as AccountRow | undefined;
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
    requireKnownAccount(this, accountId);
    requireSafeNonZeroCents(transaction.amountCents);
    const description = transaction.description?.trim();
    try {
      this.db
        .prepare(
          "INSERT INTO transactions (user_id, id, account_id, amount_cents, description) VALUES (?, ?, ?, ?, ?)",
        )
        .run(this.userId, id, accountId, transaction.amountCents, description || null);
    } catch (error) {
      throwIfDuplicateTransaction(error, id);
      throw error;
    }
    return {
      id,
      accountId,
      amountCents: transaction.amountCents,
      ...(description ? { description } : {}),
    };
  }

  listTransactions(accountId?: string): Transaction[] {
    if (accountId !== undefined) requireKnownAccount(this, requireText(accountId, "Account id"));
    const rows = accountId === undefined
      ? (this.db
          .prepare(
            "SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? ORDER BY rowid",
          )
          .all(this.userId) as TransactionRow[])
      : (this.db
          .prepare(
            "SELECT id, account_id, amount_cents, description FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid",
          )
          .all(this.userId, accountId) as TransactionRow[]);
    return rows.map(toTransaction);
  }

  getBalance(accountId: string): number {
    const id = requireText(accountId, "Account id");
    requireKnownAccount(this, id);
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) AS balance_cents FROM transactions WHERE user_id = ? AND account_id = ?",
      )
      .get(this.userId, id) as { balance_cents: number | bigint };
    const balance = Number(row.balance_cents);
    if (!Number.isSafeInteger(balance)) {
      throw new RangeError("Account balance exceeds safe integer cents");
    }
    return balance;
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

function requireKnownAccount(store: LedgerStore, accountId: string): void {
  if (!store.getAccount(accountId)) throw new Error(`Unknown account: ${accountId}`);
}

function requireSafeNonZeroCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents)) {
    throw new TypeError("Transaction amountCents must be a safe integer");
  }
  if (amountCents === ZERO_CENTS) throw new RangeError("Transaction amountCents cannot be zero");
}

function throwIfDuplicateAccount(error: unknown, id: string): void {
  if (isConstraintError(error)) throw new Error(`Account already exists: ${id}`);
}

function throwIfDuplicateTransaction(error: unknown, id: string): void {
  if (isConstraintError(error)) throw new Error(`Transaction already exists: ${id}`);
}

function isConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes(CONSTRAINT_FAILED);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}
