import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingSchemaColumns, validateRows } from "../src/schema.js";

function schema(columns) {
  return { columns };
}

test("findMissingSchemaColumns returns columns absent from header", () => {
  const missing = findMissingSchemaColumns(schema({ a: { type: "string" }, b: { type: "string" } }), ["a"]);
  assert.deepEqual(missing, ["b"]);
});

test("findMissingSchemaColumns returns empty when all columns exist", () => {
  const missing = findMissingSchemaColumns(schema({ a: { type: "string" } }), ["a", "b"]);
  assert.deepEqual(missing, []);
});

test("validateRows accepts valid strings", () => {
  const result = validateRows([{ region: "north" }], schema({ region: { type: "string" } }), ["region"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.validRows, [{ region: "north" }]);
});

test("validateRows rejects missing required values", () => {
  const result = validateRows([{ region: "" }], schema({ region: { type: "string", required: true } }), ["region"]);
  assert.deepEqual(result.errors, ["row 1: region: required value missing"]);
});

test("validateRows allows missing optional values", () => {
  const result = validateRows([{ region: "" }], schema({ region: { type: "string" } }), ["region"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.validRows, [{ region: "" }]);
});

test("validateRows enforces enum", () => {
  const result = validateRows(
    [{ region: "west" }],
    schema({ region: { type: "string", enum: ["north", "south"] } }),
    ["region"],
  );
  assert.deepEqual(result.errors, ["row 1: region: value must be one of north, south"]);
});

test("validateRows converts integer columns to numbers", () => {
  const result = validateRows([{ qty: "42" }], schema({ qty: { type: "integer" } }), ["qty"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.validRows, [{ qty: 42 }]);
});

test("validateRows rejects non-integer values", () => {
  const result = validateRows([{ qty: "3.14" }], schema({ qty: { type: "integer" } }), ["qty"]);
  assert.deepEqual(result.errors, ["row 1: qty: value must be an integer"]);
});

test("validateRows rejects integers outside min/max", () => {
  const result = validateRows(
    [{ qty: "-1" }, { qty: "11" }],
    schema({ qty: { type: "integer", min: 0, max: 10 } }),
    ["qty"],
  );
  assert.deepEqual(result.errors, [
    "row 1: qty: value must be at least 0",
    "row 2: qty: value must be at most 10",
  ]);
});

test("validateRows converts number columns to numbers", () => {
  const result = validateRows([{ amount: "2.5" }], schema({ amount: { type: "number" } }), ["amount"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.validRows, [{ amount: 2.5 }]);
});

test("validateRows rejects non-numeric values", () => {
  const result = validateRows([{ amount: "abc" }], schema({ amount: { type: "number" } }), ["amount"]);
  assert.deepEqual(result.errors, ["row 1: amount: value must be a number"]);
});

test("validateRows rejects numbers outside min/max", () => {
  const result = validateRows(
    [{ amount: "-0.01" }, { amount: "100.01" }],
    schema({ amount: { type: "number", min: 0, max: 100 } }),
    ["amount"],
  );
  assert.deepEqual(result.errors, [
    "row 1: amount: value must be at least 0",
    "row 2: amount: value must be at most 100",
  ]);
});

test("validateRows accepts real calendar dates", () => {
  const result = validateRows([{ day: "2026-02-28" }], schema({ day: { type: "date" } }), ["day"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.validRows, [{ day: "2026-02-28" }]);
});

test("validateRows rejects malformed dates", () => {
  const result = validateRows([{ day: "28-02-2026" }], schema({ day: { type: "date" } }), ["day"]);
  assert.deepEqual(result.errors, ["row 1: day: value must be a date in YYYY-MM-DD format"]);
});

test("validateRows rejects impossible calendar dates", () => {
  const result = validateRows([{ day: "2026-02-30" }], schema({ day: { type: "date" } }), ["day"]);
  assert.deepEqual(result.errors, ["row 1: day: value must be a real calendar date"]);
});

test("validateRows converts boolean columns to booleans", () => {
  const result = validateRows([{ paid: "true" }, { paid: "false" }], schema({ paid: { type: "boolean" } }), ["paid"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.validRows, [{ paid: true }, { paid: false }]);
});

test("validateRows rejects invalid booleans", () => {
  const result = validateRows([{ paid: "yes" }], schema({ paid: { type: "boolean" } }), ["paid"]);
  assert.deepEqual(result.errors, ["row 1: paid: value must be a boolean (true/false)"]);
});

test("validateRows counts dropped rows", () => {
  const result = validateRows(
    [{ qty: "1" }, { qty: "bad" }, { qty: "3" }],
    schema({ qty: { type: "integer" } }),
    ["qty"],
  );
  assert.equal(result.droppedCount, 1);
  assert.deepEqual(result.validRows, [{ qty: 1 }, { qty: 3 }]);
});
