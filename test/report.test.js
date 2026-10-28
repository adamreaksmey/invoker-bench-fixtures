import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRows, formatCsv, formatJson, formatRows } from "../src/report.js";

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

test("formatJson pretty-prints an array with 2-space indent and trailing newline", () => {
  const rows = [{ name: "apple", amount: 2.5 }];
  assert.equal(formatJson(rows), '[\n  {\n    "name": "apple",\n    "amount": 2.5\n  }\n]\n');
});

test("formatJson serialises numbers as JSON numbers", () => {
  const rows = [{ region: "north", sum_amount: 4, count: 2 }];
  assert.equal(formatJson(rows), '[\n  {\n    "region": "north",\n    "sum_amount": 4,\n    "count": 2\n  }\n]\n');
});

test("formatCsv emits a header and quoted fields only when needed", () => {
  const rows = [{ name: "apple, inc", amount: 2 }, { name: "pear", amount: 3 }];
  assert.equal(formatCsv(rows), 'name,amount\n"apple, inc",2\npear,3\n');
});

test("formatCsv escapes quotes and newlines", () => {
  const rows = [
    { name: "a", note: "x\ny" },
    { name: "b", note: 'say "hi"' },
  ];
  assert.equal(formatCsv(rows), 'name,note\na,"x\ny"\nb,"say ""hi"""\n');
});

test("formatCsv returns an empty string for no rows", () => {
  assert.equal(formatCsv([]), "");
});

test("formatRows dispatches to the named format", () => {
  const rows = [{ name: "apple" }];
  assert.equal(formatRows(rows, "json"), formatJson(rows));
  assert.equal(formatRows(rows, "csv"), formatCsv(rows));
  assert.equal(formatRows(rows, "table"), 'name\napple\n');
});

test("formatRows throws for an unknown format", () => {
  assert.throws(() => formatRows([], "xml"), /unknown format 'xml'/);
});
