/** A ledger row as needed by the reporting functions. Amounts are positive values. */
export interface ReportTransaction {
  date: string | Date;
  amount: number;
  categoryId?: string | null;
  type?: "income" | "expense";
}

export interface CategoryReport {
  categoryId: string;
  total: number;
  count: number;
}

export interface LedgerReport {
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
  categories: CategoryReport[];
}

export interface MonthlyReport extends LedgerReport {
  month: string;
}

const UNCATEGORIZED = "uncategorized";

function isIncome(transaction: ReportTransaction): boolean {
  return transaction.type === "income";
}

function validAmount(transaction: ReportTransaction): boolean {
  return Number.isFinite(transaction.amount) && transaction.amount >= 0;
}

function dateOf(transaction: ReportTransaction): Date | undefined {
  const date = transaction.date instanceof Date
    ? new Date(transaction.date.getTime())
    : new Date(transaction.date);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Summarize income, expenses, and expense totals by category. */
export function buildReport(transactions: readonly ReportTransaction[]): LedgerReport {
  let income = 0;
  let expenses = 0;
  let transactionCount = 0;
  const categories = new Map<string, CategoryReport>();

  for (const transaction of transactions) {
    if (!validAmount(transaction)) continue;
    transactionCount += 1;
    if (isIncome(transaction)) {
      income += transaction.amount;
      continue;
    }

    expenses += transaction.amount;
    const categoryId = transaction.categoryId || UNCATEGORIZED;
    const category = categories.get(categoryId) ?? { categoryId, total: 0, count: 0 };
    category.total += transaction.amount;
    category.count += 1;
    categories.set(categoryId, category);
  }

  return {
    income,
    expenses,
    net: income - expenses,
    transactionCount,
    categories: [...categories.values()].sort((a, b) => a.categoryId.localeCompare(b.categoryId)),
  };
}

/** Return one report for each UTC calendar month containing a valid transaction. */
export function buildMonthlyReports(
  transactions: readonly ReportTransaction[],
): MonthlyReport[] {
  const groups = new Map<string, ReportTransaction[]>();
  for (const transaction of transactions) {
    if (!validAmount(transaction)) continue;
    const date = dateOf(transaction);
    if (!date) continue;
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const group = groups.get(month) ?? [];
    group.push(transaction);
    groups.set(month, group);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, group]) => ({ month, ...buildReport(group) }));
}
