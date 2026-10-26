import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

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

test("groups and sums a column", () => {
  const result = runCli([writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"), "--group-by", "region", "--sum", "amount"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+4/);
  assert.match(result.stdout, /south\s+2/);
});

test("prints usage without an input file", () => {
  const result = runCli([]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});

test("validates schema rules and converts numeric columns", () => {
  const result = runCli([
    writeCsv("region,amount,qty,day,paid\nnorth,12.5,2,2024-02-29,true\n"),
    "--schema",
    writeSchema({ columns: {
      region: { type: "string", required: true, enum: ["north", "south"] },
      amount: { type: "number", required: true, min: 0 },
      qty: { type: "integer" },
      day: { type: "date" },
      paid: { type: "boolean" },
    } }),
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /12\.5\s+2/);
});

test("reports one validation error per invalid cell and suppresses output", () => {
  const result = runCli([
    writeCsv("name,qty,day\n,1.5,2023-02-29\n"),
    "--schema",
    writeSchema({ columns: {
      name: { type: "string", required: true },
      qty: { type: "integer" },
      day: { type: "date" },
    } }),
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /row 1: name: required/);
  assert.match(result.stderr, /row 1: qty: expected integer/);
  assert.match(result.stderr, /row 1: day: expected date \(YYYY-MM-DD\)/);
  assert.equal(result.stderr.trim().split("\n").length, 3);
});

test("skips invalid rows and reports the number of skipped rows", () => {
  const result = runCli([
    writeCsv("name,amount\ngood,4\nbad,nope\nalso-good,2\n"),
    "--schema",
    writeSchema({ columns: { amount: { type: "number" } } }),
    "--skip-invalid",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /row 2: amount: expected number/);
  assert.match(result.stderr, /skipped 1 invalid row\(s\)/);
  assert.match(result.stdout, /good\s+4/);
  assert.match(result.stdout, /also-good\s+2/);
  assert.doesNotMatch(result.stdout, /bad/);
});

test("rejects a schema column absent from the CSV header", () => {
  const result = runCli([
    writeCsv("name\nAda\n"),
    "--schema",
    writeSchema({ columns: { age: { type: "integer" } } }),
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "error: missing column age\n");
});

test("enforces enum, numeric bounds, and boolean values", () => {
  const result = runCli([
    writeCsv("region,low,high,paid\nwest,-1,11,yes\n"),
    "--schema",
    writeSchema({ columns: {
      region: { type: "string", enum: ["north", "south"] },
      low: { type: "number", min: 0 },
      high: { type: "integer", max: 10 },
      paid: { type: "boolean" },
    } }),
  ]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /row 1: region:/);
  assert.match(result.stderr, /row 1: low:/);
  assert.match(result.stderr, /row 1: high:/);
  assert.match(result.stderr, /row 1: paid: expected boolean/);
});
