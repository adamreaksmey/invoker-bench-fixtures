# csvreport

Summarize CSV exports from the command line.

`csvreport` reads RFC 4180 CSV files, optionally validates them against a JSON
schema, groups and aggregates rows, and emits the result as a table, CSV, or
JSON.

## Install

```bash
npm ci
```

## Usage

```bash
csvreport <input.csv> [options]
```

## Options

- `--schema <file.json>` — Validate rows against a JSON schema.
- `--skip-invalid` — Drop invalid rows instead of failing. Validation errors are
  still printed to stderr.
- `--group-by <column>` — Group rows by `<column>`.
- `--sum <column>` — Add a `sum_<column>` column per group.
- `--count` — Add a `count` column per group.
- `--format table|csv|json` — Output format (default: `table`).
- `--out <path>` — Write output to `<path>` instead of stdout.

## Exit codes

- `0` — Success.
- `1` — Usage or I/O error (unknown flag, missing/unreadable file, bad
  `--format`).
- `2` — Validation error.

## Examples

Print rows as a table:

```bash
node bin/csvreport.js examples/sales.csv
```

Group by region and sum amount:

```bash
node bin/csvreport.js examples/sales.csv --group-by region --sum amount
```

Validate against a schema and emit JSON:

```bash
node bin/csvreport.js examples/sales.csv --schema schema.json --format json
```

Write CSV output to a file:

```bash
node bin/csvreport.js examples/sales.csv --format csv --out report.csv
```

## Schema

A schema is a JSON object with a `columns` mapping. Each column may specify a
`type`, whether it is `required`, an `enum` of allowed values, and `min` /
`max` bounds for numeric types.

Supported types:

- `string`
- `integer`
- `number`
- `date` (`YYYY-MM-DD`, must be a real calendar date)
- `boolean` (`true` or `false`)

Example:

```json
{
  "columns": {
    "region": { "type": "string", "required": true, "enum": ["north", "south"] },
    "amount": { "type": "number", "required": true, "min": 0 },
    "qty": { "type": "integer" },
    "day": { "type": "date" },
    "paid": { "type": "boolean" }
  }
}
```

## Development

```bash
npm test
npm run build
```
