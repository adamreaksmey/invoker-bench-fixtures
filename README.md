# csvreport

Summarize CSV exports from the command line.

```bash
npm ci
npm test
npm run build
node bin/csvreport.js examples/sales.csv --group-by region --sum amount
node bin/csvreport.js examples/sales.csv --format json --out report.json
```

## Usage

```
csvreport <input.csv> [--schema <file.json>] [--skip-invalid] [--group-by <col> [--sum <col>] [--count]] [--format table|csv|json] [--out <path>]
```

- `--schema <file.json>` validates each row against the column types in the schema.
- `--skip-invalid` drops invalid rows instead of failing the run.
- `--group-by <col>` groups rows, `--sum <col>` adds `sum_<col>`, `--count` adds `count`.
- `--format` accepts `table` (default), `csv`, or `json`.
- `--out <path>` writes the rendered report to a file and leaves stdout empty.

## Argument handling

Arguments are parsed strictly, so a typo never silently changes the meaning of a
command. These cases all exit `1` and print a message to stderr:

| Situation | stderr message |
| --- | --- |
| No input file | `usage: csvreport <input.csv> ...` |
| Unknown flag | `error: unknown option --nope` |
| Value option with no value | `error: missing value for --format` |
| Extra positional argument | `error: unexpected argument other.csv` |
| Input file missing or unreadable | `error: cannot read input file <path>` |
| Unsupported `--format` | `error: unsupported --format <value>` |
| Unwritable `--out` path | `error: cannot write output file <path>` |

## Exit codes

- `0` — success.
- `1` — usage or I/O error; the stderr message starts with `usage:` or `error:`.
- `2` — validation errors (invalid cells, or a schema column missing from the header).
