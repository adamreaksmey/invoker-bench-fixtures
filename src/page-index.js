import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parsePage } from "./front-matter.js";
import { listSlugs, pagePath } from "./pages.js";
import { runInTransaction, runMigrations } from "./sqlite-migrations.js";

export const DEFAULT_INDEX_PATH = "wiki-index.sqlite";

const CONTENT_HASH_ALGORITHM = "sha256";
const SEARCH_TABLE = "pages_fts";
const FTS_TOKENIZER = "unicode61 remove_diacritics 2";

const CREATE_PAGE_INDEX_SQL = `
  CREATE TABLE pages (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    content_hash TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE ${SEARCH_TABLE} USING fts5(
    slug UNINDEXED,
    title,
    body,
    tokenize = '${FTS_TOKENIZER}'
  );

  CREATE TABLE page_tags (
    slug TEXT NOT NULL REFERENCES pages (slug) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (slug, tag)
  );

  CREATE INDEX page_tags_by_tag ON page_tags (tag);
`;

export const PAGE_INDEX_MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, apply: (database) => database.exec(CREATE_PAGE_INDEX_SQL) }),
]);

function prepareStatements(database) {
  return {
    selectIndexedHashes: database.prepare("SELECT slug, content_hash FROM pages"),
    upsertPage: database.prepare(`
      INSERT INTO pages (slug, title, body, content_hash) VALUES (?, ?, ?, ?)
      ON CONFLICT (slug) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        content_hash = excluded.content_hash
    `),
    deletePageRow: database.prepare("DELETE FROM pages WHERE slug = ?"),
    deletePageTags: database.prepare("DELETE FROM page_tags WHERE slug = ?"),
    insertPageTag: database.prepare("INSERT INTO page_tags (slug, tag) VALUES (?, ?)"),
    deleteSearchRow: database.prepare(`DELETE FROM ${SEARCH_TABLE} WHERE slug = ?`),
    insertSearchRow: database.prepare(`INSERT INTO ${SEARCH_TABLE} (slug, title, body) VALUES (?, ?, ?)`),
  };
}

function hashSource(source) {
  return createHash(CONTENT_HASH_ALGORITHM).update(source).digest("hex");
}

function readSource(pagesDir, slug) {
  try {
    return readFileSync(pagePath(pagesDir, slug), "utf8");
  } catch {
    return undefined;
  }
}

function listIndexableSlugs(pagesDir) {
  return existsSync(pagesDir) ? listSlugs(pagesDir) : [];
}

/**
 * SQLite index of the pages directory: page rows, an FTS5 table over title and
 * body, and tag rows. Markdown files stay the source of truth.
 */
export function createPageIndex({ pagesDir, indexPath }) {
  if (!pagesDir) throw new TypeError("pagesDir is required");
  if (!indexPath) throw new TypeError("indexPath is required");

  const database = new DatabaseSync(indexPath);
  database.exec("PRAGMA foreign_keys = ON");
  runMigrations(database, PAGE_INDEX_MIGRATIONS);
  const statements = prepareStatements(database);

  function writeIndexRows(slug, title, tags, body, contentHash) {
    statements.upsertPage.run(slug, title, body, contentHash);
    statements.deletePageTags.run(slug);
    for (const tag of tags) statements.insertPageTag.run(slug, tag);
    statements.deleteSearchRow.run(slug);
    statements.insertSearchRow.run(slug, title, body);
  }

  /** Re-indexes one page from its full Markdown source (front matter included). */
  function replacePage(slug, source) {
    const { title, tags, body } = parsePage(source, slug);
    const contentHash = hashSource(source);
    runInTransaction(database, () => writeIndexRows(slug, title, tags, body, contentHash));
  }

  function removePage(slug) {
    runInTransaction(database, () => {
      statements.deleteSearchRow.run(slug);
      statements.deletePageRow.run(slug);
    });
  }

  /** Brings the index in line with the directory: new, changed, and vanished pages. */
  function syncWithDirectory() {
    const indexedHashes = new Map(statements.selectIndexedHashes.all().map((row) => [row.slug, row.content_hash]));

    for (const slug of listIndexableSlugs(pagesDir)) {
      const source = readSource(pagesDir, slug);
      if (source === undefined) continue;
      const knownHash = indexedHashes.get(slug);
      indexedHashes.delete(slug);
      if (knownHash === hashSource(source)) continue;
      replacePage(slug, source);
    }

    for (const vanishedSlug of indexedHashes.keys()) removePage(vanishedSlug);
  }

  return {
    replacePage,
    removePage,
    syncWithDirectory,
    close: () => database.close(),
  };
}
