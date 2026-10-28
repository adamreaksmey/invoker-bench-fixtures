import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRows } from "../src/report.js";

function makeRow(region, amount) {
  return { region, amount };
}

test("groupRows returns only group keys when no sum or count is requested", () => {
  const rows = [makeRow("north", 1), makeRow("south", 2)];
  const result = groupRows(rows, "region");
  assert.deepEqual(result, [{ region: "north" }, { region: "south" }]);
});

test("groupRows sums a column and rounds to two decimals", () => {
  const rows = [makeRow("north", 1), makeRow("south", 2), makeRow("north", 3)];
  const result = groupRows(rows, "region", { sumColumn: "amount" });
  assert.deepEqual(result, [
    { region: "north", sum_amount: 4 },
    { region: "south", sum_amount: 2 },
  ]);
});

test("groupRows counts rows per group", () => {
  const rows = [makeRow("north", 1), makeRow("south", 2), makeRow("north", 3)];
  const result = groupRows(rows, "region", { includeCount: true });
  assert.deepEqual(result, [
    { region: "north", count: 2 },
    { region: "south", count: 1 },
  ]);
});

test("groupRows outputs group, sum, and count in order", () => {
  const rows = [makeRow("south", 1.2), makeRow("north", 2.3), makeRow("south", 3.4)];
  const result = groupRows(rows, "region", { sumColumn: "amount", includeCount: true });
  assert.deepEqual(result, [
    { region: "north", sum_amount: 2.3, count: 1 },
    { region: "south", sum_amount: 4.6, count: 2 },
  ]);
});

test("groupRows sorts groups by key ascending", () => {
  const rows = [makeRow("west", 0), makeRow("east", 0), makeRow("north", 0)];
  const result = groupRows(rows, "region", { includeCount: true });
  assert.deepEqual(result, [
    { region: "east", count: 1 },
    { region: "north", count: 1 },
    { region: "west", count: 1 },
  ]);
});

test("groupRows avoids floating-point noise by rounding sums", () => {
  const rows = [makeRow("north", 0.1), makeRow("north", 0.2)];
  const result = groupRows(rows, "region", { sumColumn: "amount" });
  assert.deepEqual(result, [{ region: "north", sum_amount: 0.3 }]);
});
