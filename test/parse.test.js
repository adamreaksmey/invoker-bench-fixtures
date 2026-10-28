import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/parse.js";

function parseSingleRow(csv) {
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1, `expected one data row from ${JSON.stringify(csv)}`);
  return rows[0];
}

test("splits simple comma-separated records into row objects", () => {
  const rows = parseCsv("name,qty\napple,2\npear,5\n");
  assert.deepEqual(rows, [
    { name: "apple", qty: "2" },
    { name: "pear", qty: "5" },
  ]);
});

test("keeps a comma inside a quoted field", () => {
  const row = parseSingleRow('name,address\n"Doe, Jane",Paris\n');
  assert.deepEqual(row, { name: "Doe, Jane", address: "Paris" });
});

test("unescapes a doubled quote inside a quoted field", () => {
  const row = parseSingleRow('quote,author\n"She said ""hi""",Ann\n');
  assert.deepEqual(row, { quote: 'She said "hi"', author: "Ann" });
});

test("keeps a newline inside a quoted field within one record", () => {
  const rows = parseCsv('note,id\n"line one\nline two",7\n');
  assert.deepEqual(rows, [{ note: "line one\nline two", id: "7" }]);
});

test("keeps a CRLF newline inside a quoted field within one record", () => {
  const rows = parseCsv('note,id\r\n"line one\r\nline two",7\r\n');
  assert.deepEqual(rows, [{ note: "line one\r\nline two", id: "7" }]);
});

test("parses CRLF record separators", () => {
  const rows = parseCsv("name,qty\r\napple,2\r\npear,5\r\n");
  assert.deepEqual(rows, [
    { name: "apple", qty: "2" },
    { name: "pear", qty: "5" },
  ]);
});

test("parses a mixed CRLF and LF file", () => {
  const rows = parseCsv("name,qty\r\napple,2\npear,5\r\n");
  assert.deepEqual(rows, [
    { name: "apple", qty: "2" },
    { name: "pear", qty: "5" },
  ]);
});

test("strips a leading UTF-8 BOM from the header", () => {
  const row = parseSingleRow("\uFEFFname,qty\napple,2\n");
  assert.deepEqual(Object.keys(row), ["name", "qty"]);
  assert.deepEqual(row, { name: "apple", qty: "2" });
});

test("accepts input with no trailing newline", () => {
  const rows = parseCsv("name,qty\napple,2");
  assert.deepEqual(rows, [{ name: "apple", qty: "2" }]);
});

test("does not emit a phantom row for a trailing newline", () => {
  assert.equal(parseCsv("name\napple\n").length, 1);
  assert.equal(parseCsv("name\napple").length, 1);
});

test("does not emit a phantom row for a trailing CRLF", () => {
  assert.equal(parseCsv("name\r\napple\r\n").length, 1);
});

test("keeps fields that are quoted but empty", () => {
  const row = parseSingleRow('a,b,c\n"",,x\n');
  assert.deepEqual(row, { a: "", b: "", c: "x" });
});

test("keeps a field that contains only a quoted newline", () => {
  const row = parseSingleRow('note,id\n"\n",1\n');
  assert.deepEqual(row, { note: "\n", id: "1" });
});

test("preserves leading and trailing spaces in unquoted fields", () => {
  const row = parseSingleRow("a,b\n padded ,x \n");
  assert.deepEqual(row, { a: " padded ", b: "x " });
});

test("fills cells missing from a short record with empty strings", () => {
  const rows = parseCsv("a,b,c\n1,2\n");
  assert.deepEqual(rows, [{ a: "1", b: "2", c: "" }]);
});

test("returns an empty array for empty input", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("returns no rows when the input is only a header", () => {
  assert.deepEqual(parseCsv("a,b\n"), []);
});

test("skips blank lines between records", () => {
  const rows = parseCsv("a,b\n1,2\n\n3,4\n");
  assert.deepEqual(rows, [
    { a: "1", b: "2" },
    { a: "3", b: "4" },
  ]);
});

test("handles a quoted field holding the delimiter and quotes at once", () => {
  const row = parseSingleRow('value,n\n"""a,b""",1\n');
  assert.deepEqual(row, { value: '"a,b"', n: "1" });
});
