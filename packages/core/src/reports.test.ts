import { describe, expect, it } from "vitest";
import { buildMonthlyReports, buildReport } from "./reports";

describe("buildReport", () => {
  it("totals income, expenses, and categorized expenses", () => {
    expect(buildReport([
      { date: "2026-01-02", amount: 24, categoryId: "food" },
      { date: "2026-01-03", amount: 8, categoryId: "food" },
      { date: "2026-01-04", amount: 50, type: "income" },
      { date: "2026-01-05", amount: 5 },
    ])).toEqual({
      income: 50,
      expenses: 37,
      net: 13,
      transactionCount: 4,
      categories: [
        { categoryId: "food", total: 32, count: 2 },
        { categoryId: "uncategorized", total: 5, count: 1 },
      ],
    });
  });

  it("ignores invalid or negative amounts", () => {
    expect(buildReport([
      { date: "2026-01-01", amount: -3 },
      { date: "2026-01-02", amount: Number.NaN },
    ])).toEqual({ income: 0, expenses: 0, net: 0, transactionCount: 0, categories: [] });
  });
});

describe("buildMonthlyReports", () => {
  it("groups by UTC month and returns months in chronological order", () => {
    expect(buildMonthlyReports([
      { date: "2026-02-01T00:00:00Z", amount: 10, categoryId: "travel" },
      { date: "2026-01-31T23:30:00-02:00", amount: 20, type: "income" },
      { date: "not-a-date", amount: 100 },
    ])).toEqual([
      {
        month: "2026-02", income: 20, expenses: 10, net: 10, transactionCount: 2,
        categories: [{ categoryId: "travel", total: 10, count: 1 }],
      },
    ]);
  });
});
