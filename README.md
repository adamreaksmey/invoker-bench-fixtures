# csvreport

Summarize CSV exports from the command line. Parses RFC 4180 CSV (quoted
fields, escaped quotes, newlines in fields, CRLF/LF, optional UTF-8 BOM),
optionally validates against a JSON schema, aggregates with `--group-by` /
`--sum` / `--count`, and prints `table`, `csv`, or `json`.

## Setup

```bash
npm ci
npm test
npm run build
```

## Usage

```bash
node bin/csvreport.js <input.csv> [options]
# or, after install: csvreport <input.csv> [options]
```

### Options

| Option | Description |
| --- | --- |
| `--schema <file.json>` | Validate columns against a JSON schema |
| `--skip-invalid` | Drop invalid rows (still report them), then continue |
| `--group-by <column>` | Group rows by column (groups sorted ascending) |
| `--sum <column>` | With `--group-by`, add `sum_<column>` (2 decimal places) |
| `--count` | With `--group-by`, add a `count` column |
| `--format table\|csv\|json` | Output format (default: `table`) |
| `--out <path>` | Write output to a file (stdout stays empty) |

Without `--group-by`, rows are printed as-is in input order.

### Schema file

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

Supported types: `string`, `integer`, `number`, `date` (`YYYY-MM-DD`),
`boolean` (`true` / `false`). Empty cells are missing; required missing values
are errors. `enum` restricts values; `min` / `max` apply to `integer` and
`number`.

### Examples

```bash
node bin/csvreport.js examples/sales.csv --group-by region --sum amount
node bin/csvreport.js examples/sales.csv --format json --out report.json
node bin/csvreport.js data.csv --schema schema.json --skip-invalid --format csv
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Usage or I/O error (unknown flag, missing/unreadable file, bad `--format`). stderr starts with `usage:` or `error:` |
| `2` | Schema validation errors (or missing schema column). stderr lists `row <n>: <column>: <message>` lines |

No runtime npm dependencies; Node built-ins only.
