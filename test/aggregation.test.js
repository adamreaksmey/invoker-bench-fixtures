import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";
import { groupRows } from "../src/report.js";

const SALES_CSV = [
  "region,amount",
  "south,4.25",
  "north,10.50",
  "south,1.75",
  "north,7.00",
  "",
].join("\n");

function writeCsv(contents) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-aggregation-")), "input.csv");
  writeFileSync(path, contents);
  return path;
}

function runCli(argv) {
  const output = { stdout: "", stderr: "" };
  const exitCode = run(argv, {
    stdout: (text) => { output.stdout += text; },
    stderr: (text) => { output.stderr += text; },
  });
  return { exitCode, ...output };
}

function reportLines(stdout) {
  return stdout.trimEnd().split("\n").map((line) => line.split(/\s{2,}/));
}

test("groups rows sorted by key with sum and count columns", () => {
  const result = runCli([writeCsv(SALES_CSV), "--group-by", "region", "--sum", "amount", "--count"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(reportLines(result.stdout), [
    ["region", "sum_amount", "count"],
    ["north", "17.5", "2"],
    ["south", "6", "2"],
  ]);
});

test("omits the sum column when --sum is absent", () => {
  const rows = groupRows(
    [{ region: "north" }, { region: "north" }, { region: "south" }],
    { groupBy: "region", sumColumn: undefined, count: true },
  );
  assert.deepEqual(rows, [
    { region: "north", count: 2 },
    { region: "south", count: 1 },
  ]);
});

test("omits the count column when --count is absent", () => {
  const rows = groupRows([{ region: "north", amount: 2 }], { groupBy: "region", sumColumn: "amount", count: false });
  assert.deepEqual(rows, [{ region: "north", sum_amount: 2 }]);
});

test("groups by key alone when neither --sum nor --count is given", () => {
  const rows = groupRows([{ region: "north" }, { region: "north" }], { groupBy: "region" });
  assert.deepEqual(rows, [{ region: "north" }]);
});

test("rounds sums to two decimals", () => {
  const rows = groupRows(
    [{ region: "north", amount: 0.1 }, { region: "north", amount: 0.2 }, { region: "north", amount: 1.005 }],
    { groupBy: "region", sumColumn: "amount" },
  );
  assert.deepEqual(rows, [{ region: "north", sum_amount: 1.31 }]);
});

test("sorts group keys ascending by string comparison", () => {
  const rows = groupRows(
    [{ region: "10" }, { region: "9" }, { region: "North" }, { region: "north" }],
    { groupBy: "region", count: true },
  );
  assert.deepEqual(rows.map((row) => row.region), ["10", "9", "North", "north"]);
});

test("sums numeric strings when no schema converted the cells", () => {
  const result = runCli([writeCsv(SALES_CSV), "--group-by", "region", "--sum", "amount"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+17\.5/);
  assert.match(result.stdout, /south\s+6\b/);
});

test("sums numbers converted by a schema", () => {
  const csvPath = writeCsv("region,amount\nnorth,1.115\nnorth,2.115\n");
  const schemaPath = join(mkdtempSync(join(tmpdir(), "csvreport-aggregation-schema-")), "schema.json");
  writeFileSync(schemaPath, JSON.stringify({ columns: { region: { type: "string" }, amount: { type: "number" } } }));
  const result = runCli([csvPath, "--schema", schemaPath, "--group-by", "region", "--sum", "amount", "--count"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(reportLines(result.stdout), [
    ["region", "sum_amount", "count"],
    ["north", "3.23", "2"],
  ]);
});

test("outputs rows as-is without --group-by", () => {
  const result = runCli([writeCsv("region,amount\nsouth,4.25\nnorth,10.50\n"), "--sum", "amount", "--count"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(reportLines(result.stdout), [
    ["region", "amount"],
    ["south", "4.25"],
    ["north", "10.50"],
  ]);
});

test("keeps input order for rows when --group-by is absent", () => {
  const result = runCli([writeCsv(SALES_CSV), "--count"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(reportLines(result.stdout), [
    ["region", "amount"],
    ["south", "4.25"],
    ["north", "10.50"],
    ["south", "1.75"],
    ["north", "7.00"],
  ]);
});

test("ignores non-numeric sum cells instead of producing NaN", () => {
  const rows = groupRows(
    [{ region: "north", amount: "3" }, { region: "north", amount: "" }, { region: "north", amount: "n/a" }],
    { groupBy: "region", sumColumn: "amount", count: true },
  );
  assert.deepEqual(rows, [{ region: "north", sum_amount: 3, count: 3 }]);
});

test("groups a file with no data rows into no groups", () => {
  const result = runCli([writeCsv("region,amount\n"), "--group-by", "region", "--count"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
});
