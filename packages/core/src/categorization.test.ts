import { describe, expect, it } from "vitest";
import { CATEGORIES, categorizeTransaction } from "./categorization";

describe("categorizeTransaction", () => {
  it.each([
    ["ACME PAYROLL", "income"],
    ["Monthly rent payment", "housing"],
    ["Whole Foods Market", "groceries"],
    ["Uber trip", "transportation"],
    ["Electric bill", "utilities"],
    ["Neighborhood pharmacy", "healthcare"],
    ["Coffee at the cafe", "dining"],
    ["Netflix subscription", "entertainment"],
    ["Amazon order", "shopping"],
  ])("maps %s to %s", (description, category) => {
    expect(categorizeTransaction(description)).toBe(category);
  });

  it("returns uncategorized for unknown or blank descriptions", () => {
    expect(categorizeTransaction("Transfer to savings")).toBe("uncategorized");
    expect(categorizeTransaction("   ")).toBe("uncategorized");
  });

  it("exposes the supported category set", () => {
    expect(CATEGORIES).toContain("uncategorized");
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
  });
});
