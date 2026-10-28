import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRows } from "../src/validate.js";

function validate(header, rows, schema) {
  const errors = [];
  const result = validateRows(header, rows, schema, (message) => errors.push(message));
  return { ...result, errors };
}

test("accepts valid strings", () => {
  const result = validate(["name"], [["alice"]], { columns: { name: { type: "string" } } });
  assert.equal(result.success, true);
  assert.deepEqual(result.validRows, [{ name: "alice" }]);
});

test("reports a missing required string", () => {
  const result = validate(["name"], [[""]], { columns: { name: { type: "string", required: true } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /missing required value/);
});

test("allows an empty optional string as null", () => {
  const result = validate(["name"], [[""]], { columns: { name: { type: "string" } } });
  assert.equal(result.success, true);
  assert.deepEqual(result.validRows, [{ name: null }]);
});

test("enforces string enum", () => {
  const result = validate(["region"], [["east"]], {
    columns: { region: { type: "string", enum: ["north", "south"] } },
  });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /value not in enum/);
});

test("accepts integer values", () => {
  const result = validate(["qty"], [["42"]], { columns: { qty: { type: "integer" } } });
  assert.equal(result.success, true);
  assert.deepEqual(result.validRows, [{ qty: 42 }]);
});

test("rejects non-integer values", () => {
  const result = validate(["qty"], [["3.5"]], { columns: { qty: { type: "integer" } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /expected integer/);
});

test("rejects integers below min", () => {
  const result = validate(["qty"], [["-1"]], { columns: { qty: { type: "integer", min: 0 } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /value below min 0/);
});

test("rejects integers above max", () => {
  const result = validate(["qty"], [["11"]], { columns: { qty: { type: "integer", max: 10 } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /value above max 10/);
});

test("accepts number values", () => {
  const result = validate(["amount"], [["10.5"]], { columns: { amount: { type: "number" } } });
  assert.equal(result.success, true);
  assert.deepEqual(result.validRows, [{ amount: 10.5 }]);
});

test("rejects invalid numbers", () => {
  const result = validate(["amount"], [["abc"]], { columns: { amount: { type: "number" } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /expected number/);
});

test("enforces number min", () => {
  const result = validate(["amount"], [["-0.01"]], { columns: { amount: { type: "number", min: 0 } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /value below min 0/);
});

test("accepts valid dates", () => {
  const result = validate(["day"], [["2026-01-03"]], { columns: { day: { type: "date" } } });
  assert.equal(result.success, true);
  assert.deepEqual(result.validRows, [{ day: "2026-01-03" }]);
});

test("rejects malformed dates", () => {
  const result = validate(["day"], [["not-a-date"]], { columns: { day: { type: "date" } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /expected date/);
});

test("rejects impossible calendar dates", () => {
  const result = validate(["day"], [["2026-02-30"]], { columns: { day: { type: "date" } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /expected date/);
});

test("accepts boolean values", () => {
  const result = validate(["paid"], [["true"], ["false"]], { columns: { paid: { type: "boolean" } } });
  assert.equal(result.success, true);
  assert.deepEqual(result.validRows, [{ paid: true }, { paid: false }]);
});

test("rejects invalid boolean values", () => {
  const result = validate(["paid"], [["yes"]], { columns: { paid: { type: "boolean" } } });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /expected boolean/);
});

test("reports a missing schema column", () => {
  const result = validate(["amount"], [["10"]], {
    columns: { region: { type: "string", required: true } },
  });
  assert.equal(result.missingColumn, true);
  assert.match(result.errors[0], /error: missing column region/);
});

test("reports multiple errors on the same row", () => {
  const result = validate(
    ["region", "amount"],
    [["north", "bad"]],
    { columns: { region: { type: "string", enum: ["south"] }, amount: { type: "number" } } }
  );
  assert.equal(result.success, false);
  assert.equal(result.errors.length, 2);
});

test("keeps non-schema columns in output", () => {
  const result = validate(
    ["region", "note"],
    [["north", "hello"]],
    { columns: { region: { type: "string" } } }
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.validRows, [{ region: "north", note: "hello" }]);
});

test("counts invalid rows", () => {
  const result = validate(
    ["amount"],
    [["1"], ["bad"], ["2"]],
    { columns: { amount: { type: "number" } } }
  );
  assert.equal(result.invalidCount, 1);
  assert.deepEqual(result.validRows, [{ amount: 1 }, { amount: 2 }]);
});
