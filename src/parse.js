const UTF8_BOM = "\uFEFF";
const QUOTE = '"';
const COMMA = ",";
const CR = "\r";
const LF = "\n";

export function parseCsv(text) {
  const content = stripUtf8Bom(text);
  const records = parseRecords(content);
  if (records.length === 0) {
    return [];
  }
  const [header, ...dataRecords] = records;
  return dataRecords.map((cells) => rowFromCells(header, cells));
}

function stripUtf8Bom(text) {
  if (!text.startsWith(UTF8_BOM)) {
    return text;
  }
  return text.slice(UTF8_BOM.length);
}

function rowFromCells(header, cells) {
  return Object.fromEntries(
    header.map((column, index) => [column, cells[index] ?? ""])
  );
}

function parseRecords(text) {
  const state = {
    records: [],
    fields: [],
    field: "",
    inQuotes: false,
  };
  let index = 0;
  while (index < text.length) {
    index = consumeCharacter(state, text, index);
  }
  finishRecordIfPending(state);
  return state.records;
}

function consumeCharacter(state, text, index) {
  const character = text[index];
  if (state.inQuotes) {
    return consumeQuotedCharacter(state, text, index, character);
  }
  return consumeUnquotedCharacter(state, text, index, character);
}

function consumeQuotedCharacter(state, text, index, character) {
  if (character !== QUOTE) {
    state.field += character;
    return index + 1;
  }
  if (text[index + 1] === QUOTE) {
    state.field += QUOTE;
    return index + 2;
  }
  state.inQuotes = false;
  return index + 1;
}

function consumeUnquotedCharacter(state, text, index, character) {
  if (character === QUOTE) {
    state.inQuotes = true;
    return index + 1;
  }
  if (character === COMMA) {
    endField(state);
    return index + 1;
  }
  if (character === CR || character === LF) {
    return endRecordAtLineBreak(state, text, index, character);
  }
  state.field += character;
  return index + 1;
}

function endRecordAtLineBreak(state, text, index, character) {
  endField(state);
  state.records.push(state.fields);
  state.fields = [];
  if (character === CR && text[index + 1] === LF) {
    return index + 2;
  }
  return index + 1;
}

function endField(state) {
  state.fields.push(state.field);
  state.field = "";
}

function finishRecordIfPending(state) {
  const hasPendingField = state.field.length > 0;
  const hasPendingFields = state.fields.length > 0;
  if (!hasPendingField && !hasPendingFields) {
    return;
  }
  endField(state);
  state.records.push(state.fields);
  state.fields = [];
}
