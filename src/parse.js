export function parseCsv(text) {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records = [];
  let record = [];
  let field = "";
  let fieldStarted = false;
  let inQuotes = false;

  const finishField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };

  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && !fieldStarted && field.length === 0) {
      inQuotes = true;
      fieldStarted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRecord();
    } else {
      field += character;
      fieldStarted = true;
    }
  }

  if (inQuotes) throw new Error("unterminated quoted field");
  if (record.length > 0 || fieldStarted || field.length > 0) finishRecord();

  const [header = [], ...dataRecords] = records;
  return dataRecords.map((cells) => Object.fromEntries(
    header.map((column, index) => [column, cells[index] ?? ""]),
  ));
}
