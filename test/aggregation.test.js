import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRows } from "../src/report.js";
import { run } from "../src/cli.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GROUP_COLUMN = "region";
const SUM_COLUMN = "amount";
const SUM_OUTPUT_COLUMN = "sum_amount";
const COUNT_COLUMN = "count";

function writeCsv(contents) {
  const directory = mkdtempSync(join(tmpdir(), "csvreport-"));
  const path = join(directory, "input.csv");
  writeFileSync(path, contents);
  return path;
}

function runCli(argv) {
  const output = { stdout: "", stderr: "" };
  const exitCode = run(argv, {
    stdout: (text) => {
      output.stdout += text;
    },
    stderr: (text) => {
      output.stderr += text;
    },
  });
  return { exitCode, ...output };
}

test("sums a column rounded to two decimals", () => {
  const rows = groupRows(
    [
      { region: "north", amount: 0.1 },
      { region: "north", amount: 0.2 },
    ],
    GROUP_COLUMN,
    { sum: SUM_COLUMN }
  );
  assert.deepEqual(rows, [{ region: "north", [SUM_OUTPUT_COLUMN]: 0.3 }]);
});

test("counts rows per group", () => {
  const rows = groupRows(
    [
      { region: "south", amount: 1 },
      { region: "north", amount: 2 },
      { region: "north", amount: 3 },
    ],
    GROUP_COLUMN,
    { count: true }
  );
  assert.deepEqual(rows, [
    { region: "north", [COUNT_COLUMN]: 2 },
    { region: "south", [COUNT_COLUMN]: 1 },
  ]);
});

test("orders columns as group, sum, then count", () => {
  const rows = groupRows(
    [
      { region: "east", amount: 1.5 },
      { region: "east", amount: 2.5 },
    ],
    GROUP_COLUMN,
    { sum: SUM_COLUMN, count: true }
  );
  assert.deepEqual(Object.keys(rows[0]), [
    GROUP_COLUMN,
    SUM_OUTPUT_COLUMN,
    COUNT_COLUMN,
  ]);
  assert.deepEqual(rows, [
    { region: "east", [SUM_OUTPUT_COLUMN]: 4, [COUNT_COLUMN]: 2 },
  ]);
});

test("sorts groups by key ascending", () => {
  const rows = groupRows(
    [
      { region: "west", amount: 1 },
      { region: "east", amount: 2 },
      { region: "north", amount: 3 },
    ],
    GROUP_COLUMN,
    { sum: SUM_COLUMN }
  );
  assert.deepEqual(
    rows.map((row) => row.region),
    ["east", "north", "west"]
  );
});

test("cli --count with --group-by prints counts", () => {
  const result = runCli([
    writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"),
    "--group-by",
    GROUP_COLUMN,
    "--count",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+2/);
  assert.match(result.stdout, /south\s+1/);
});

test("cli --group-by --sum --count prints all aggregate columns", () => {
  const result = runCli([
    writeCsv("region,amount\nsouth,2.25\nnorth,1.10\nnorth,2.20\n"),
    "--group-by",
    GROUP_COLUMN,
    "--sum",
    SUM_COLUMN,
    "--count",
  ]);
  assert.equal(result.exitCode, 0);
  const lines = result.stdout.trim().split("\n");
  assert.match(lines[0], /region\s+sum_amount\s+count/);
  assert.match(lines[1], /north\s+3\.3\s+2/);
  assert.match(lines[2], /south\s+2\.25\s+1/);
});

test("without --group-by outputs rows as-is", () => {
  const result = runCli([
    writeCsv("region,amount\nsouth,2\nnorth,1\n"),
  ]);
  assert.equal(result.exitCode, 0);
  const lines = result.stdout.trim().split("\n");
  assert.match(lines[1], /south\s+2/);
  assert.match(lines[2], /north\s+1/);
});
