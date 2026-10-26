import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";
import { parseCsv } from "../src/parse.js";

function writeTemp(filename, contents) {
  const directory = mkdtempSync(join(tmpdir(), "csvreport-"));
  const path = join(directory, filename);
  writeFileSync(path, contents);
  return path;
}

function writeCsv(contents) {
  return writeTemp("input.csv", contents);
}

function writeSchema(contents) {
  return writeTemp("schema.json", contents);
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

test("prints rows as a table", () => {
  const result = runCli([writeCsv("name,qty\napple,2\npear,5\n")]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /apple\s+2/);
  assert.match(result.stdout, /pear\s+5/);
});

test("groups and sums a column", () => {
  const result = runCli([
    writeCsv("region,amount\nnorth,1\nsouth,2\nnorth,3\n"),
    "--group-by",
    "region",
    "--sum",
    "amount",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /north\s+4/);
  assert.match(result.stdout, /south\s+2/);
});

test("prints usage without an input file", () => {
  const result = runCli([]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^usage:/);
});

test("parses quoted fields with commas and escaped quotes", () => {
  const { columns, rows } = parseCsv('name,note\n"a,b","say ""hi"""\n');
  assert.deepEqual(columns, ["name", "note"]);
  assert.deepEqual(rows, [{ name: "a,b", note: 'say "hi"' }]);
});

test("parses newlines inside quotes and CRLF line endings", () => {
  const { rows } = parseCsv('id,note\r\n1,"line1\r\nline2"\r\n');
  assert.deepEqual(rows, [{ id: "1", note: "line1\r\nline2" }]);
});

test("strips a UTF-8 BOM and allows a trailing newline", () => {
  const { columns, rows } = parseCsv("\uFEFFa,b\n1,2\n");
  assert.deepEqual(columns, ["a", "b"]);
  assert.deepEqual(rows, [{ a: "1", b: "2" }]);
});

test("rejects unknown flags with exit 1", () => {
  const result = runCli([writeCsv("a,b\n1,2\n"), "--nope"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("rejects a missing input file with exit 1", () => {
  const result = runCli([join(tmpdir(), "csvreport-missing-input.csv")]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

test("rejects an invalid format with exit 1", () => {
  const result = runCli([writeCsv("a,b\n1,2\n"), "--format", "xml"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /^error:/);
});

const FULL_SCHEMA = JSON.stringify({
  columns: {
    region: { type: "string", required: true, enum: ["north", "south"] },
    amount: { type: "number", required: true, min: 0 },
    qty: { type: "integer" },
    day: { type: "date" },
    paid: { type: "boolean" },
  },
});

test("schema accepts valid typed rows", () => {
  const csv = writeCsv(
    "region,amount,qty,day,paid\nnorth,1.5,2,2026-01-03,true\nsouth,0,1,2026-02-28,false\n",
  );
  const result = runCli([csv, "--schema", writeSchema(FULL_SCHEMA), "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), [
    { region: "north", amount: 1.5, qty: 2, day: "2026-01-03", paid: true },
    { region: "south", amount: 0, qty: 1, day: "2026-02-28", paid: false },
  ]);
});

test("schema reports a missing required column", () => {
  const result = runCli([
    writeCsv("amount\n1\n"),
    "--schema",
    writeSchema(JSON.stringify({ columns: { region: { type: "string", required: true } } })),
  ]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /^error: missing column region$/m);
  assert.equal(result.stdout, "");
});

test("schema validates required, enum, min, types, and calendar dates", () => {
  const csv = writeCsv(
    "region,amount,qty,day,paid\n" +
      ",1,1,2026-01-01,true\n" +
      "east,1,1,2026-01-01,true\n" +
      "north,-1,1,2026-01-01,true\n" +
      "north,1,1.5,2026-01-01,true\n" +
      "north,abc,1,2026-01-01,true\n" +
      "north,1,1,2026-02-30,true\n" +
      "north,1,1,2026-01-01,yes\n",
  );
  const result = runCli([csv, "--schema", writeSchema(FULL_SCHEMA)]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /row 1: region: required value missing/);
  assert.match(result.stderr, /row 2: region: value not in enum/);
  assert.match(result.stderr, /row 3: amount: below minimum/);
  assert.match(result.stderr, /row 4: qty: invalid integer/);
  assert.match(result.stderr, /row 5: amount: invalid number/);
  assert.match(result.stderr, /row 6: day: invalid date/);
  assert.match(result.stderr, /row 7: paid: invalid boolean/);
});

test("schema allows missing optional values and enforces max", () => {
  const schema = writeSchema(
    JSON.stringify({
      columns: {
        qty: { type: "integer", max: 10 },
        note: { type: "string" },
      },
    }),
  );
  const invalid = runCli([writeCsv("qty,note\n11,\n"), "--schema", schema]);
  assert.equal(invalid.exitCode, 2);
  assert.match(invalid.stderr, /row 1: qty: above maximum/);

  const valid = runCli([writeCsv("qty,note\n,,\n"), "--schema", schema, "--format", "json"]);
  assert.equal(valid.exitCode, 0);
  assert.deepEqual(JSON.parse(valid.stdout), [{ qty: "", note: "" }]);
});

test("skip-invalid drops bad rows, prints errors, and exits 0", () => {
  const csv = writeCsv("region,amount\nnorth,1\neast,2\nsouth,3\n");
  const schema = writeSchema(
    JSON.stringify({
      columns: {
        region: { type: "string", required: true, enum: ["north", "south"] },
        amount: { type: "number", required: true },
      },
    }),
  );
  const result = runCli([csv, "--schema", schema, "--skip-invalid", "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /row 2: region: value not in enum/);
  assert.match(result.stderr, /skipped 1 invalid row\(s\)/);
  assert.deepEqual(JSON.parse(result.stdout), [
    { region: "north", amount: 1 },
    { region: "south", amount: 3 },
  ]);
});

test("groups with sum rounded to 2 decimals, count, and sorted keys", () => {
  const result = runCli([
    writeCsv("region,amount\nsouth,1.005\nnorth,1.1\nsouth,1.001\nnorth,2.2\n"),
    "--group-by",
    "region",
    "--sum",
    "amount",
    "--count",
    "--format",
    "json",
  ]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [
    { region: "north", sum_amount: 3.3, count: 2 },
    { region: "south", sum_amount: 2.01, count: 2 },
  ]);
});

test("outputs csv format with quoting only when needed", () => {
  const result = runCli([
    writeCsv('name,note\nplain,ok\n"a,b","say ""hi"""\n'),
    "--format",
    "csv",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'name,note\nplain,ok\n"a,b","say ""hi"""\n');
});

test("outputs json format with trailing newline and numeric values", () => {
  const csv = writeCsv("region,amount\nnorth,2\n");
  const schema = writeSchema(
    JSON.stringify({ columns: { region: { type: "string" }, amount: { type: "number" } } }),
  );
  const result = runCli([csv, "--schema", schema, "--format", "json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '[\n  {\n    "region": "north",\n    "amount": 2\n  }\n]\n');
});

test("writes output to --out and leaves stdout empty", () => {
  const outPath = writeTemp("out.json", "");
  const result = runCli([
    writeCsv("name,qty\napple,2\n"),
    "--format",
    "json",
    "--out",
    outPath,
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(readFileSync(outPath, "utf8")), [{ name: "apple", qty: "2" }]);
});
