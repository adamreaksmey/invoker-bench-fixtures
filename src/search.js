export const MAX_SEARCH_RESULTS = 20;
export const SNIPPET_MARKER = "**";
export const SNIPPET_ELLIPSIS = "...";
export const SNIPPET_TOKEN_COUNT = 16;
export const SNIPPET_LEAD_TOKENS = 3;
export const TITLE_WEIGHT = 10;
export const BODY_WEIGHT = 1;

// Mirrors the unicode61 tokenizer of the FTS5 table: runs of letters, digits,
// and combining marks. Everything else is punctuation and stays out of queries.
const TERM_PATTERN = /[\p{L}\p{N}\p{M}]+/gu;
const COMBINING_MARK_PATTERN = /\p{M}+/gu;
const WHITESPACE_PATTERN = /\s+/gu;

/** Lowercases and strips accents so scoring agrees with `unicode61 remove_diacritics 2`. */
function normalizeToken(token) {
  return token.normalize("NFD").replace(COMBINING_MARK_PATTERN, "").toLowerCase();
}

/** Returns every word of `text` with its offsets in the source string. */
function collectWordTokens(text) {
  return [...text.matchAll(TERM_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    term: normalizeToken(match[0]),
  }));
}

/** Splits user input into plain-text terms, so punctuation never reaches FTS5 syntax. */
export function parseSearchTerms(queryText) {
  if (typeof queryText !== "string") return [];
  const terms = collectWordTokens(queryText).map((token) => token.term);
  return [...new Set(terms.filter((term) => term.length > 0))];
}

/** Builds an FTS5 MATCH expression requiring every term; quoting makes each term literal. */
export function buildMatchExpression(terms) {
  return terms.map((term) => `"${term}"`).join(" AND ");
}

/** A missing, non-string, or whitespace-only `q` is a bad request. */
export function isBlankQuery(queryText) {
  return typeof queryText !== "string" || queryText.trim().length === 0;
}

function countTermOccurrences(text, term) {
  return collectWordTokens(text).filter((token) => token.term === term).length;
}

/** Relevance of one page: a title hit counts more than a body hit. */
export function scorePage({ title, body }, terms) {
  return terms.reduce(
    (total, term) =>
      total + TITLE_WEIGHT * countTermOccurrences(title, term) + BODY_WEIGHT * countTermOccurrences(body, term),
    0,
  );
}

function firstMatchingTokenIndex(tokens, terms) {
  return tokens.findIndex((token) => terms.has(token.term));
}

function windowStartIndex(tokens, terms) {
  const matchIndex = firstMatchingTokenIndex(tokens, terms);
  if (matchIndex === -1) return 0;
  return Math.max(0, matchIndex - SNIPPET_LEAD_TOKENS);
}

function wrapMatchedTerm(text, token, terms) {
  return terms.has(token.term) ? `${SNIPPET_MARKER}${text}${SNIPPET_MARKER}` : text;
}

function collapseWhitespace(text) {
  return text.replace(WHITESPACE_PATTERN, " ");
}

function renderWindow(body, windowTokens, terms) {
  let rendered = "";
  let cursor = windowTokens[0].start;
  for (const token of windowTokens) {
    const word = body.slice(token.start, token.end);
    rendered += collapseWhitespace(body.slice(cursor, token.start)) + wrapMatchedTerm(word, token, terms);
    cursor = token.end;
  }
  return rendered;
}

/**
 * A short body excerpt with matched terms wrapped in `**`, or "" for an empty
 * body. The excerpt starts at a word boundary near the first match.
 */
export function buildSnippet(body, terms) {
  const tokens = collectWordTokens(body);
  if (tokens.length === 0) return "";
  const termSet = new Set(terms);
  const startIndex = windowStartIndex(tokens, termSet);
  const windowTokens = tokens.slice(startIndex, startIndex + SNIPPET_TOKEN_COUNT);
  const hasLeadingText = startIndex > 0;
  const hasTrailingText = windowTokens.at(-1).end < tokens.at(-1).end;
  const leading = hasLeadingText ? SNIPPET_ELLIPSIS : "";
  const trailing = hasTrailingText ? SNIPPET_ELLIPSIS : "";
  return `${leading}${renderWindow(body, windowTokens, termSet).trim()}${trailing}`;
}

function compareByRelevance(left, right) {
  return right.score - left.score || left.slug.localeCompare(right.slug);
}

/** Scores matches with shared weights, orders best first (slug breaks ties), and caps the count. */
export function rankSearchResults(matches, terms) {
  return matches
    .map(({ slug, title, body }) => ({
      slug,
      title,
      snippet: buildSnippet(body, terms),
      score: scorePage({ title, body }, terms),
    }))
    .sort(compareByRelevance)
    .slice(0, MAX_SEARCH_RESULTS);
}
