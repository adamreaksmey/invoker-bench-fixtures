import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

function writeCsv(contents) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-")), "input.csv");
  writeFileSync(path, contents);
  return path;
}

function writeJson(contents) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-")), "schema.json");
  writeFileSync(path, JSON.stringify(contents));
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

test("parses quoted commas, escaped quotes, multiline fields, BOM, and CRLF", () => {
  const result = runCli([writeCsv("\ufeffname,note\r\n\"Smith, Jane\",\"said \"\"hello\"\"\"\r\n\"multi\nline\",ok\r\n") , "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [
    { name: "Smith, Jane", note: 'said "hello"' },
    { name: "multi\nline", note: "ok" },
  ]);
});

test("validates schema rules and converts typed values", () => {
  const schema = writeJson({ columns: {
    region: { type: "string", required: true, enum: ["north", "south"] },
    amount: { type: "number", required: true, min: 0, max: 10 },
    qty: { type: "integer" }, day: { type: "date" }, paid: { type: "boolean" },
  } });
  const result = runCli([writeCsv("region,amount,qty,day,paid\nnorth,2.5,3,2024-02-29,true\n"), "--schema", schema, "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [{ region: "north", amount: 2.5, qty: 3, day: "2024-02-29", paid: true }]);
});

test("reports every invalid cell and suppresses output by default", () => {
  const schema = writeJson({ columns: {
    region: { type: "string", required: true, enum: ["north"] },
    amount: { type: "number", min: 0 }, qty: { type: "integer" }, day: { type: "date" }, paid: { type: "boolean" },
  } });
  const result = runCli([writeCsv("region,amount,qty,day,paid\n,abc,1.2,2023-02-29,yes\n"), "--schema", schema]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /row 1: region: is required/);
  assert.match(result.stderr, /row 1: amount: must be a number/);
  assert.match(result.stderr, /row 1: qty: must be an integer/);
  assert.match(result.stderr, /row 1: day: must be a valid date/);
  assert.match(result.stderr, /row 1: paid: must be true or false/);
});

test("skips invalid rows and reports the count", () => {
  const schema = writeJson({ columns: { amount: { type: "number", required: true } } });
  const result = runCli([writeCsv("region,amount\nnorth,2\nsouth,nope\n"), "--schema", schema, "--skip-invalid", "--format", "csv"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "region,amount\nnorth,2\n");
  assert.match(result.stderr, /skipped 1 invalid row\(s\)/);
});

test("groups with rounded sums, counts, and sorted keys", () => {
  const result = runCli([writeCsv("region,amount\nz,1.005\na,2\nz,2.005\n"), "--group-by", "region", "--sum", "amount", "--count", "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [
    { region: "a", sum_amount: 2, count: 1 },
    { region: "z", sum_amount: 3.01, count: 2 },
  ]);
});

test("formats CSV quoting, JSON, and writes --out without stdout", () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "csvreport-")), "report.csv");
  const result = runCli([writeCsv("name,note\nDoe,\"a,b\"\n"), "--format", "csv", "--out", outputPath]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(outputPath, "utf8"), "name,note\nDoe,\"a,b\"\n");
});

test("rejects a schema column absent from the header", () => {
  const result = runCli([writeCsv("name\nAda\n"), "--schema", writeJson({ columns: { age: { type: "integer" } } })]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "error: missing column age\n");
});

test("rejects unknown flags and bad formats with usage errors", () => {
  const input = writeCsv("name\nAda\n");
  assert.equal(runCli([input, "--wat"]).exitCode, 1);
  assert.equal(runCli([input, "--format", "xml"]).exitCode, 1);
});
