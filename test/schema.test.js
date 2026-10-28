import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

const VALIDATION_SCHEMA = {
  columns: {
    region: { type: "string", required: true, enum: ["north", "south"] },
    amount: { type: "number", required: true, min: 0 },
    qty: { type: "integer" },
    day: { type: "date" },
    paid: { type: "boolean" },
  },
};

const VALID_CSV = "region,amount,qty,day,paid\nnorth,10.50,2,2026-01-03,true\nsouth,4.25,1,2026-01-04,false\n";

function writeTempFile(contents, fileName) {
  const path = join(mkdtempSync(join(tmpdir(), "csvreport-schema-")), fileName);
  writeFileSync(path, contents);
  return path;
}

function writeCsv(contents) {
  return writeTempFile(contents, "input.csv");
}

function writeSchema(schema) {
  return writeTempFile(JSON.stringify(schema), "schema.json");
}

function runCli(argv) {
  const output = { stdout: "", stderr: "" };
  const exitCode = run(argv, {
    stdout: (text) => { output.stdout += text; },
    stderr: (text) => { output.stderr += text; },
  });
  return { exitCode, ...output };
}

function runWithSchema(csv, { schema = VALIDATION_SCHEMA, extraArguments = [] } = {}) {
  return runCli([writeCsv(csv), "--schema", writeSchema(schema), ...extraArguments]);
}

function singleColumnSchema(definition) {
  return { columns: { value: definition } };
}

function validateSingleCell(cellText, definition) {
  return runWithSchema(`value\n${cellText}\n`, { schema: singleColumnSchema(definition) });
}

test("accepts rows that satisfy every schema rule", () => {
  const result = runWithSchema(VALID_CSV);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /north\s+10\.5\s+2\s+2026-01-03\s+true/);
});

test("reports a missing schema column and exits 2 with empty stdout", () => {
  const result = runWithSchema("region,amount\nnorth,1\n");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "error: missing column qty\nerror: missing column day\nerror: missing column paid\n");
});

test("reports a missing schema column even when the file has no data rows", () => {
  const result = runWithSchema("region,amount\n");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /error: missing column qty/);
});

test("rejects a non-numeric value in an integer column", () => {
  const result = runWithSchema("region,amount,qty,day,paid\nnorth,1,2.5,2026-01-03,true\n");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "row 1: qty: expected an integer\n");
});

test("rejects a non-numeric value in a number column", () => {
  const result = runWithSchema("region,amount,qty,day,paid\nnorth,abc,1,2026-01-03,true\n");
  assert.equal(result.stderr, "row 1: amount: expected a number\n");
});

test("accepts integer and decimal number spellings", () => {
  for (const amount of ["0", "12", "-3.5", ".5", "1e3"]) {
    const result = validateSingleCell(amount, { type: "number" });
    assert.equal(result.exitCode, 0, `expected ${amount} to be a valid number`);
  }
});

test("rejects an impossible calendar date", () => {
  const result = validateSingleCell("2026-02-30", { type: "date" });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "row 1: value: expected a date (YYYY-MM-DD)\n");
});

test("accepts a real leap-day calendar date", () => {
  assert.equal(validateSingleCell("2024-02-29", { type: "date" }).exitCode, 0);
});

test("rejects a date that is not zero-padded", () => {
  assert.equal(validateSingleCell("2026-1-03", { type: "date" }).exitCode, 2);
});

test("rejects a boolean value outside true and false", () => {
  const result = validateSingleCell("yes", { type: "boolean" });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, "row 1: value: expected true or false\n");
});

test("accepts true and false booleans", () => {
  assert.equal(validateSingleCell("true", { type: "boolean" }).exitCode, 0);
  assert.equal(validateSingleCell("false", { type: "boolean" }).exitCode, 0);
});

test("rejects a value outside the enum", () => {
  const result = validateSingleCell("west", { type: "string", enum: ["north", "south"] });
  assert.equal(result.stderr, "row 1: value: expected one of: north, south\n");
});

test("rejects a number below min and above max", () => {
  assert.equal(validateSingleCell("-1", { type: "number", min: 0 }).stderr, "row 1: value: must be at least 0\n");
  assert.equal(validateSingleCell("101", { type: "integer", max: 100 }).stderr, "row 1: value: must be at most 100\n");
});

test("rejects an empty required value and accepts an empty optional value", () => {
  assert.equal(validateSingleCell('""', { type: "string", required: true }).stderr, "row 1: value: required value is missing\n");
  assert.equal(validateSingleCell('""', { type: "string" }).exitCode, 0);
  assert.equal(validateSingleCell('""', { type: "integer" }).exitCode, 0);
});

test("treats a cell missing from a short record as empty", () => {
  const result = runWithSchema("value,other\n,1\n", { schema: { columns: { value: { type: "string", required: true } } } });
  assert.equal(result.stderr, "row 1: value: required value is missing\n");
});

test("numbers data rows from 1 and reports every invalid cell", () => {
  const csv = "region,amount,qty,day,paid\nnorth,1,1,2026-01-03,true\nwest,nope,x,2026-13-01,maybe\n";
  const result = runWithSchema(csv);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "row 2: region: expected one of: north, south\n" +
      "row 2: amount: expected a number\n" +
      "row 2: qty: expected an integer\n" +
      "row 2: day: expected a date (YYYY-MM-DD)\n" +
      "row 2: paid: expected true or false\n",
  );
});

test("prints nothing to stdout and exits 2 when any row is invalid", () => {
  const csv = "region,amount,qty,day,paid\nnorth,1,1,2026-01-03,true\nsouth,bad,1,2026-01-03,true\n";
  const result = runWithSchema(csv);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^row 2: amount: expected a number\n$/);
});

test("--skip-invalid drops invalid rows and continues with exit 0", () => {
  const csv = "region,amount,qty,day,paid\nnorth,1,1,2026-01-03,true\nsouth,bad,1,2026-01-03,true\nnorth,2,2,2026-01-04,false\n";
  const result = runWithSchema(csv, { extraArguments: ["--skip-invalid"] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "row 2: amount: expected a number\nskipped 1 invalid row(s)\n");
  assert.match(result.stdout, /north\s+1\s+1\s+2026-01-03\s+true/);
  assert.match(result.stdout, /north\s+2\s+2\s+2026-01-04\s+false/);
  assert.doesNotMatch(result.stdout, /bad/);
});

test("--skip-invalid reports every skipped row in the count", () => {
  const csv = "region,amount,qty,day,paid\nwest,1,1,2026-01-03,true\nnorth,1,1,2026-01-03,true\neast,1,1,2026-01-03,true\n";
  const result = runWithSchema(csv, { extraArguments: ["--skip-invalid"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /skipped 2 invalid row\(s\)\n$/);
});

test("converts integer and number columns to numbers before aggregation", () => {
  const csv = "region,amount,qty,day,paid\nnorth,1.5,2,2026-01-03,true\nnorth,2.25,3,2026-01-04,false\n";
  const result = runWithSchema(csv, { extraArguments: ["--group-by", "region", "--sum", "amount"] });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "region  sum_amount\nnorth   3.75\n");
});

test("a schema error from an unreadable file exits 1", () => {
  const result = runCli([writeCsv("a\n1\n"), "--schema", join(tmpdir(), "csvreport-missing-schema.json")]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("an unparseable schema file exits 1", () => {
  const schemaPath = writeTempFile("{not json", "schema.json");
  const result = runCli([writeCsv("a\n1\n"), "--schema", schemaPath]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("a schema with an unknown column type exits 1", () => {
  const result = runWithSchema("value\n1\n", { schema: singleColumnSchema({ type: "decimal" }) });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});
