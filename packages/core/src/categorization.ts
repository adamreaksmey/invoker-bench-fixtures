/** Categories used by the personal ledger's first-pass transaction classifier. */
export const CATEGORIES = [
  "income",
  "housing",
  "groceries",
  "transportation",
  "utilities",
  "healthcare",
  "dining",
  "entertainment",
  "shopping",
  "uncategorized",
] as const;

export type Category = (typeof CATEGORIES)[number];

const RULES: ReadonlyArray<readonly [Category, ReadonlyArray<string>]> = [
  ["income", ["payroll", "salary", "wages", "paycheck", "deposit"]],
  ["housing", ["rent", "mortgage", "property tax", "landlord"]],
  ["groceries", ["grocery", "groceries", "supermarket", "whole foods", "market"]],
  ["transportation", ["gas station", "fuel", "transit", "bus", "uber", "lyft", "parking", "train"]],
  ["utilities", ["electric", "electricity", "water bill", "utility", "internet", "phone bill"]],
  ["healthcare", ["pharmacy", "doctor", "hospital", "clinic", "medical", "dentist"]],
  ["dining", ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "food delivery"]],
  ["entertainment", ["movie", "cinema", "netflix", "spotify", "concert", "theater"]],
  ["shopping", ["amazon", "store", "clothing", "retail", "purchase"]],
];

/** Categorize a transaction description using case-insensitive keyword matching. */
export function categorizeTransaction(description: string): Category {
  const normalized = description.trim().toLocaleLowerCase();
  for (const [category, keywords] of RULES) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return category;
  }
  return "uncategorized";
}
