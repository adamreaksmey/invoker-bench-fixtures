import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";
import { validateRows } from "../src/schema.js";

function writeCsv(contents) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-")), "input.csv");
  writeFileSync(path, contents);
  return path;
}

function writeSchema(schema) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-")), "schema.json");
  writeFileSync(path, JSON.stringify(schema));
  return path;
}

function runCli(argv) {
  const output = { stdout: "", stderr: "" };
  const exitCode = run(argv, { stdout: (text) => { output.stdout += text; }, stderr: (text) => { output.stderr += text; } });
  return { exitCode, ...output };
}

test("prints rows as a table", () => {
  const result = runCli([writeCsv("name,qty\napple,2\npear,5\n")]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /apple\s+2/);
  assert.match(result.stdout, /pear\s+5/);
});

test("prints pretty JSON with numeric values and a trailing newline", () => {
  const schema = writeSchema({ columns: { qty: { type: "integer" } } });
  const result = runCli([writeCsv("name,qty\napple,2\npear,5\n"), "--schema", schema, "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '[\n  {\n    "name": "apple",\n    "qty": 2\n  },\n  {\n    "name": "pear",\n    "qty": 5\n  }\n]\n');
});

test("prints CSV with minimal RFC quoting, LF endings, and a trailing newline", () => {
  const result = runCli([writeCsv('name,note\napple,plain\npear,"ripe, sweet"\nquote,"say ""hi"""\n'), "--format", "csv"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'name,note\napple,plain\npear,"ripe, sweet"\nquote,"say ""hi"""\n');
});

test("writes selected format to --out without writing stdout", () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "csvreport-")), "report.json");
  const result = runCli([writeCsv("name\napple\n"), "--format", "json", "--out", outputPath]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(readFileSync(outputPath, "utf8"), '[\n  {\n    "name": "apple"\n  }\n]\n');
});

test("rejects an unsupported output format", () => {
  const result = runCli([writeCsv("name\napple\n"), "--format", "xml"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("groups and sums a column", () => {
  const result = runCli([writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"), "--group-by", "region", "--sum", "amount"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+4/);
  assert.match(result.stdout, /south\s+2/);
});

test("groups by ascending key and adds rounded sums and counts in column order", () => {
  const result = runCli([
    writeCsv("region,amount\nz,0.105\na,2.1\nz,0.105\na,1.2\n"),
    "--group-by", "region", "--sum", "amount", "--count",
  ]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "region  sum_amount  count",
    "a       3.3         2",
    "z       0.21        2",
  ]);
});

test("group-by without sum or count emits one sorted row per group", () => {
  const result = runCli([writeCsv("region,amount\nz,1\na,2\nz,3\n"), "--group-by", "region"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout.trim().split("\n"), ["region", "a", "z"]);
});

test("count can be requested without sum", () => {
  const result = runCli([writeCsv("region\nb\na\nb\n"), "--group-by", "region", "--count"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout.trim().split("\n"), ["region  count", "a       1", "b       2"]);
});

test("prints usage without an input file", () => {
  const result = runCli([]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});

test("validates schema rules, reports 1-based rows, and converts numeric fields", () => {
  const schema = writeSchema({ columns: {
    region: { type: "string", required: true, enum: ["north", "south"] },
    amount: { type: "number", required: true, min: 0, max: 10 },
    qty: { type: "integer" },
    day: { type: "date" },
    paid: { type: "boolean" },
  } });
  const result = runCli([
    writeCsv("region,amount,qty,day,paid\nnorth,2.5,3,2024-02-29,true\nwest,-1,1,2024-02-30,yes\n"),
    "--schema", schema,
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /row 2: region: must be one of: north, south/);
  assert.match(result.stderr, /row 2: amount: must be at least 0/);
  assert.match(result.stderr, /row 2: day: must be a valid date \(YYYY-MM-DD\)/);
  assert.match(result.stderr, /row 2: paid: must be true or false/);
});

test("skip-invalid drops bad rows and reports the number skipped", () => {
  const schema = writeSchema({ columns: { qty: { type: "integer", required: true } } });
  const result = runCli([
    writeCsv("name,qty\napple,2\npear,nope\n"),
    "--schema", schema, "--skip-invalid",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /apple\s+2/);
  assert.doesNotMatch(result.stdout, /pear/);
  assert.match(result.stderr, /row 2: qty: must be an integer/);
  assert.match(result.stderr, /skipped 1 invalid row\(s\)/);
});

test("reports schema columns missing from the header", () => {
  const schema = writeSchema({ columns: { missing: { type: "string" } } });
  const result = runCli([writeCsv("name\napple\n"), "--schema", schema]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "error: missing column missing\n");
});

test("converts valid integer and number values to numbers", () => {
  const validation = validateRows(
    [{ qty: "3", amount: "2.5" }],
    ["qty", "amount"],
    { columns: { qty: { type: "integer" }, amount: { type: "number" } } },
  );
  assert.deepEqual(validation.rows, [{ qty: 3, amount: 2.5 }]);
});
