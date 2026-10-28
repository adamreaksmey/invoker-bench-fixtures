const FRONT_MATTER_DELIMITER = "---";
const KEY_VALUE_SEPARATOR = ":";
const TAG_SEPARATOR = ",";
const BRACKETED_LIST_PATTERN = /^\[(.*)\]$/;
const HEADING_PREFIX = "# ";

export const TITLE_KEY = "title";
export const TAGS_KEY = "tags";

const NO_ATTRIBUTES = new Map();
const NO_TAGS = Object.freeze([]);

function isDelimiterLine(line) {
  return line.trim() === FRONT_MATTER_DELIMITER;
}

function findClosingDelimiterLine(lines) {
  for (let index = 1; index < lines.length; index += 1) {
    if (isDelimiterLine(lines[index])) return index;
  }
  return -1;
}

function parseAttributeLines(lines) {
  const attributes = new Map();
  for (const line of lines) {
    const separatorIndex = line.indexOf(KEY_VALUE_SEPARATOR);
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0) continue;
    attributes.set(key, line.slice(separatorIndex + KEY_VALUE_SEPARATOR.length).trim());
  }
  return attributes;
}

/**
 * Splits a page source into its front-matter attributes and remaining body.
 * A block that is never closed is treated as ordinary page text.
 */
export function splitFrontMatter(source) {
  const lines = source.split("\n");
  const hasOpeningDelimiter = lines.length > 0 && isDelimiterLine(lines[0]);
  const closingIndex = hasOpeningDelimiter ? findClosingDelimiterLine(lines) : -1;
  if (closingIndex === -1) return { attributes: NO_ATTRIBUTES, body: source };
  return {
    attributes: parseAttributeLines(lines.slice(1, closingIndex)),
    body: lines.slice(closingIndex + 1).join("\n"),
  };
}

/** Accepts both `[a, b]` and `a, b`, returning trimmed, lowercased, sorted, unique tags. */
export function normalizeTags(rawValue) {
  if (typeof rawValue !== "string") return NO_TAGS;
  const listMatch = BRACKETED_LIST_PATTERN.exec(rawValue.trim());
  const listSource = listMatch ? listMatch[1] : rawValue;
  const tags = listSource
    .split(TAG_SEPARATOR)
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)].sort();
}

function firstHeadingTitle(body) {
  const heading = body.split("\n").find((line) => line.startsWith(HEADING_PREFIX));
  return heading ? heading.slice(HEADING_PREFIX.length).trim() : "";
}

/** Title precedence: front-matter `title`, then first `# ` heading, then slug. */
function resolveTitle(attributes, body, slug) {
  const frontMatterTitle = (attributes.get(TITLE_KEY) ?? "").trim();
  if (frontMatterTitle.length > 0) return frontMatterTitle;
  return firstHeadingTitle(body) || slug;
}

export function parsePage(source, slug) {
  const { attributes, body } = splitFrontMatter(source);
  return {
    title: resolveTitle(attributes, body, slug),
    tags: normalizeTags(attributes.get(TAGS_KEY)),
    body,
  };
}
