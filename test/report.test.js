import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateRows, formatTable, formatCsv, formatJson, formatOutput } from "../src/report.js";

test("aggregates by group and sums", () => {
  const rows = [
    { region: "north", amount: 1 },
    { region: "south", amount: 2 },
    { region: "north", amount: 3 },
  ];
  const result = aggregateRows(rows, "region", "amount", false);
  assert.deepEqual(result, [
    { region: "north", sum_amount: 4 },
    { region: "south", sum_amount: 2 },
  ]);
});

test("sorts groups ascending by string key", () => {
  const rows = [
    { region: "west", amount: 0 },
    { region: "east", amount: 0 },
  ];
  const result = aggregateRows(rows, "region", undefined, false);
  assert.deepEqual(result, [{ region: "east" }, { region: "west" }]);
});

test("rounds sums to two decimal places", () => {
  const rows = [
    { region: "a", amount: 0.105 },
    { region: "a", amount: 0.205 },
  ];
  const result = aggregateRows(rows, "region", "amount", false);
  assert.deepEqual(result, [{ region: "a", sum_amount: 0.31 }]);
});

test("adds a count column", () => {
  const rows = [
    { region: "north", amount: 1 },
    { region: "north", amount: 2 },
  ];
  const result = aggregateRows(rows, "region", undefined, true);
  assert.deepEqual(result, [{ region: "north", count: 2 }]);
});

test("adds sum and count together", () => {
  const rows = [
    { region: "north", amount: 1 },
    { region: "north", amount: 2 },
  ];
  const result = aggregateRows(rows, "region", "amount", true);
  assert.deepEqual(result, [{ region: "north", sum_amount: 3, count: 2 }]);
});

test("preserves typed group keys", () => {
  const rows = [{ qty: 10, amount: 1 }, { qty: 10, amount: 2 }];
  const result = aggregateRows(rows, "qty", "amount", false);
  assert.deepEqual(result, [{ qty: 10, sum_amount: 3 }]);
});

test("formats output as a table", () => {
  const rows = [{ name: "apple", qty: 2 }];
  const output = formatTable(rows);
  assert.match(output, /apple\s+2/);
  assert.match(output, /\n$/);
});

test("formats output as csv", () => {
  const rows = [{ name: "apple", qty: 2 }];
  const output = formatCsv(rows);
  assert.equal(output, "name,qty\napple,2\n");
});

test("quotes csv fields containing commas", () => {
  const rows = [{ note: "a,b" }];
  assert.equal(formatCsv(rows), 'note\n"a,b"\n');
});

test("quotes csv fields containing quotes", () => {
  const rows = [{ note: 'say "hi"' }];
  assert.equal(formatCsv(rows), 'note\n"say ""hi"""\n');
});

test("quotes csv fields containing newlines", () => {
  const rows = [{ note: "a\nb" }];
  assert.equal(formatCsv(rows), 'note\n"a\nb"\n');
});

test("formats output as json", () => {
  const rows = [{ name: "apple", qty: 2 }];
  const output = formatJson(rows);
  assert.equal(output, '[\n  {\n    "name": "apple",\n    "qty": 2\n  }\n]\n');
});

test("json output uses numbers for numeric values", () => {
  const rows = [{ amount: 10.5 }];
  const output = formatJson(rows);
  assert.match(output, /"amount": 10.5/);
});

test("formatOutput dispatches to the correct formatter", () => {
  const rows = [{ a: 1 }];
  assert.equal(formatOutput(rows, "csv"), "a\n1\n");
  assert.match(formatOutput(rows, "json"), /\[\n/);
  assert.match(formatOutput(rows, "table"), /a/);
});

test("formatOutput rejects unknown formats", () => {
  assert.throws(() => formatOutput([], "xml"), /unknown format/);
});
