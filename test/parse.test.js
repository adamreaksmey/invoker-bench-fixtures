import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/parse.js";

test("parses a simple comma-separated file with trailing newline", () => {
  const rows = parseCsv("name,qty\napple,2\npear,5\n");
  assert.deepEqual(rows, [
    { name: "apple", qty: "2" },
    { name: "pear", qty: "5" },
  ]);
});

test("parses files without a trailing newline", () => {
  const rows = parseCsv("name,qty\napple,2\npear,5");
  assert.deepEqual(rows, [
    { name: "apple", qty: "2" },
    { name: "pear", qty: "5" },
  ]);
});

test("parses CRLF line endings", () => {
  const rows = parseCsv("name,qty\r\napple,2\r\npear,5\r\n");
  assert.deepEqual(rows, [
    { name: "apple", qty: "2" },
    { name: "pear", qty: "5" },
  ]);
});

test("strips an optional UTF-8 BOM", () => {
  const rows = parseCsv("\uFEFFname,qty\napple,2\n");
  assert.deepEqual(rows, [{ name: "apple", qty: "2" }]);
});

test("keeps commas inside quoted fields", () => {
  const rows = parseCsv('city,note\n"New York, NY",ok\n');
  assert.deepEqual(rows, [{ city: "New York, NY", note: "ok" }]);
});

test("unescapes doubled quotes inside quoted fields", () => {
  const rows = parseCsv('name,note\n"a ""quoted"" value",x\n');
  assert.deepEqual(rows, [{ name: 'a "quoted" value', note: "x" }]);
});

test("keeps newlines inside quoted fields", () => {
  const rows = parseCsv('name,note\n"line1\nline2",ok\n');
  assert.deepEqual(rows, [{ name: "line1\nline2", note: "ok" }]);
});

test("keeps CRLF sequences inside quoted fields", () => {
  const rows = parseCsv('name,note\n"line1\r\nline2",ok\r\n');
  assert.deepEqual(rows, [{ name: "line1\r\nline2", note: "ok" }]);
});

test("treats the first record as the header", () => {
  const rows = parseCsv("region,amount\nnorth,10\n");
  assert.deepEqual(Object.keys(rows[0]), ["region", "amount"]);
  assert.equal(rows.length, 1);
});

test("preserves empty fields", () => {
  const rows = parseCsv("a,b,c\n1,,3\n");
  assert.deepEqual(rows, [{ a: "1", b: "", c: "3" }]);
});
