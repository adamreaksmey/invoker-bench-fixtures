# csvreport

Summarize CSV exports from the command line.

```bash
npm ci
npm test
npm run build
node bin/csvreport.js examples/sales.csv --group-by region --sum amount
node bin/csvreport.js examples/sales.csv --format json --out report.json
```

`--format` accepts `table` (default), `csv`, or `json`. `--out <path>` writes the
rendered report to a file and leaves stdout empty.
