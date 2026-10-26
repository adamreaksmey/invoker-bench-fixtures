export function parseCsv(text) {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const [headerLine, ...dataLines] = lines;
  const header = headerLine.split(",");
  return dataLines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((column, index) => [column, cells[index] ?? ""]));
  });
}
