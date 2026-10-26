function parseRecords(text) {
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  let afterClosingQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterClosingQuote) {
      if (character === ",") {
        record.push(field);
        field = "";
        afterClosingQuote = false;
      } else if (character === "\n") {
        record.push(field);
        records.push(record);
        record = [];
        field = "";
        afterClosingQuote = false;
      } else if (character === "\r" && text[index + 1] === "\n") {
        record.push(field);
        records.push(record);
        record = [];
        field = "";
        afterClosingQuote = false;
        index += 1;
      } else {
        throw new Error("Invalid character after closing quote");
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (character === "\r" && text[index + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("Unterminated quoted field");

  if (afterClosingQuote || field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

export function parseCsv(text) {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const [header = [], ...data] = parseRecords(input);
  return data.map((cells) => Object.fromEntries(
    header.map((column, index) => [column, cells[index] ?? ""]),
  ));
}
