import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/parse.js";

test("parses simple comma separated fields", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3\n"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("ignores a trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("handles CRLF line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("handles mixed line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("strips a UTF-8 BOM", () => {
  assert.deepEqual(parseCsv("\uFEFFa,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("supports quoted fields", () => {
  assert.deepEqual(parseCsv('a,b\n"x","y"\n'), [["a", "b"], ["x", "y"]]);
});

test("supports commas inside quoted fields", () => {
  assert.deepEqual(parseCsv('a,b\n"x,1","y,2"\n'), [["a", "b"], ["x,1", "y,2"]]);
});

test("supports escaped quotes inside quoted fields", () => {
  assert.deepEqual(parseCsv('a\n"say ""hello"""\n'), [["a"], ['say "hello"']]);
});

test("supports newlines inside quoted fields", () => {
  assert.deepEqual(parseCsv('a,b\n"line1\nline2",c\n'), [["a", "b"], ["line1\nline2", "c"]]);
});

test("supports CRLF inside quoted fields", () => {
  assert.deepEqual(parseCsv('a,b\n"line1\r\nline2",c\n'), [["a", "b"], ["line1\r\nline2", "c"]]);
});

test("supports empty quoted fields", () => {
  assert.deepEqual(parseCsv('a,b\n"",x\n'), [["a", "b"], ["", "x"]]);
});

test("supports empty unquoted fields", () => {
  assert.deepEqual(parseCsv("a,b,c\n,2,\n"), [["a", "b", "c"], ["", "2", ""]]);
});

test("supports a trailing empty field", () => {
  assert.deepEqual(parseCsv("a,b\n1,2,\n"), [["a", "b"], ["1", "2", ""]]);
});

test("returns an empty array for an empty file", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("returns an empty array for a BOM only file", () => {
  assert.deepEqual(parseCsv("\uFEFF"), []);
});
