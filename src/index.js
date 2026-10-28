import { DatabaseSync } from "node:sqlite";
import { listSlugs, readPage, pageModifiedAt } from "./pages.js";

const SCHEMA_VERSION_TABLE = "schema_version";
const PAGES_TABLE = "pages";
const FTS_TABLE = "pages_fts";
const TAGS_TABLE = "tags";
const PAGE_TAGS_TABLE = "page_tags";

const SLUG_FTS_WEIGHT = 0.0;
const TITLE_FTS_WEIGHT = 10.0;
const BODY_FTS_WEIGHT = 1.0;
const FTS_SNIPPET_COLUMN = 2;
const MAX_SEARCH_RESULTS = 20;
const SNIPPET_TOKENS = 20;
const SNIPPET_ELLIPSIS = "...";
const SNIPPET_START_MATCH = "**";
const SNIPPET_END_MATCH = "**";

const MIGRATIONS = new Map([[1, runInitialMigration]]);

function runInitialMigration(db) {
  db.exec(`
    CREATE TABLE ${PAGES_TABLE} (
      slug TEXT PRIMARY KEY,
      modified_at REAL NOT NULL
    );
    CREATE VIRTUAL TABLE ${FTS_TABLE} USING fts5(
      slug,
      title,
      body
    );
    CREATE TABLE ${TAGS_TABLE} (
      tag TEXT PRIMARY KEY
    );
    CREATE TABLE ${PAGE_TAGS_TABLE} (
      slug TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (slug, tag),
      FOREIGN KEY (slug) REFERENCES ${PAGES_TABLE}(slug),
      FOREIGN KEY (tag) REFERENCES ${TAGS_TABLE}(tag)
    );
  `);
}

function createSchemaVersionTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (version INTEGER PRIMARY KEY)`);
}

function currentSchemaVersion(db) {
  createSchemaVersionTable(db);
  const row = db.prepare(`SELECT version FROM ${SCHEMA_VERSION_TABLE} ORDER BY version DESC LIMIT 1`).get();
  return row?.version ?? 0;
}

function recordSchemaVersion(db, version) {
  db.prepare(`INSERT INTO ${SCHEMA_VERSION_TABLE} (version) VALUES (?)`).run(version);
}

function runInTransaction(db, operation) {
  db.exec("BEGIN");
  try {
    operation();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function migrateIndex(db) {
  const version = currentSchemaVersion(db);
  for (const [migrationVersion, migration] of MIGRATIONS) {
    if (migrationVersion <= version) continue;
    runInTransaction(db, () => {
      migration(db);
      recordSchemaVersion(db, migrationVersion);
    });
  }
}

function clearPageTags(db, slug) {
  db.prepare(`DELETE FROM ${PAGE_TAGS_TABLE} WHERE slug = ?`).run(slug);
}

function insertTag(db, tag) {
  db.prepare(`INSERT OR IGNORE INTO ${TAGS_TABLE} (tag) VALUES (?)`).run(tag);
}

function insertPageTags(db, slug, tags) {
  for (const tag of tags) {
    insertTag(db, tag);
    db.prepare(`INSERT OR IGNORE INTO ${PAGE_TAGS_TABLE} (slug, tag) VALUES (?, ?)`).run(slug, tag);
  }
}

function upsertPageRaw(db, page, modifiedAt) {
  db.prepare(`INSERT OR REPLACE INTO ${PAGES_TABLE} (slug, modified_at) VALUES (?, ?)`).run(page.slug, modifiedAt);
  db.prepare(`DELETE FROM ${FTS_TABLE} WHERE slug = ?`).run(page.slug);
  db.prepare(`INSERT INTO ${FTS_TABLE} (slug, title, body) VALUES (?, ?, ?)`).run(page.slug, page.title, page.body);
  clearPageTags(db, page.slug);
  insertPageTags(db, page.slug, page.tags);
}

export function upsertPageInIndex(db, page, modifiedAt) {
  runInTransaction(db, () => upsertPageRaw(db, page, modifiedAt));
}

function deletePageFromIndexRaw(db, slug) {
  db.prepare(`DELETE FROM ${FTS_TABLE} WHERE slug = ?`).run(slug);
  clearPageTags(db, slug);
  db.prepare(`DELETE FROM ${PAGES_TABLE} WHERE slug = ?`).run(slug);
}

export function deletePageFromIndex(db, slug) {
  runInTransaction(db, () => deletePageFromIndexRaw(db, slug));
}

export function syncIndex(db, pagesDir) {
  runInTransaction(db, () => {
    const indexed = db.prepare(`SELECT slug, modified_at FROM ${PAGES_TABLE}`).all();
    const indexedModifiedAt = new Map(indexed.map((row) => [row.slug, row.modified_at]));
    const slugs = listSlugs(pagesDir);
    const knownSlugs = new Set(slugs);

    for (const slug of indexedModifiedAt.keys()) {
      if (!knownSlugs.has(slug)) deletePageFromIndexRaw(db, slug);
    }

    for (const slug of slugs) {
      const modifiedAt = pageModifiedAt(pagesDir, slug);
      if (indexedModifiedAt.get(slug) === modifiedAt) continue;
      upsertPageRaw(db, readPage(pagesDir, slug), modifiedAt);
    }
  });
}

function tokenizeQuery(query) {
  return query.trim().split(/\s+/).filter((word) => word.length > 0);
}

function escapeFtsTerm(word) {
  const escaped = word.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildFtsQuery(words) {
  return words.map(escapeFtsTerm).join(" AND ");
}

export function searchPages(db, rawQuery) {
  const words = tokenizeQuery(rawQuery);
  if (words.length === 0) return { query: rawQuery, results: [] };

  const ftsQuery = buildFtsQuery(words);
  const rows = db.prepare(`
    SELECT slug, title,
      snippet(${FTS_TABLE}, ${FTS_SNIPPET_COLUMN}, '${SNIPPET_START_MATCH}', '${SNIPPET_END_MATCH}', '${SNIPPET_ELLIPSIS}', ${SNIPPET_TOKENS}) AS snippet,
      -bm25(${FTS_TABLE}, ${SLUG_FTS_WEIGHT}, ${TITLE_FTS_WEIGHT}, ${BODY_FTS_WEIGHT}) AS score
    FROM ${FTS_TABLE}
    WHERE ${FTS_TABLE} MATCH ?
    ORDER BY score DESC
    LIMIT ${MAX_SEARCH_RESULTS}
  `).all(ftsQuery);

  return {
    query: rawQuery,
    results: rows.map((row) => ({ slug: row.slug, title: row.title, snippet: row.snippet, score: row.score })),
  };
}

export function listTags(db) {
  const rows = db.prepare(`
    SELECT tag, COUNT(*) AS count
    FROM ${PAGE_TAGS_TABLE}
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `).all();
  return rows.map((row) => ({ tag: row.tag, count: row.count }));
}

export function findPagesByTag(db, tag) {
  const rows = db.prepare(`
    SELECT p.slug, ${FTS_TABLE}.title
    FROM ${PAGES_TABLE} p
    JOIN ${FTS_TABLE} ON ${FTS_TABLE}.slug = p.slug
    JOIN ${PAGE_TAGS_TABLE} pt ON p.slug = pt.slug
    WHERE pt.tag = ?
    ORDER BY p.slug
  `).all(tag.toLowerCase());
  return rows.map((row) => ({ slug: row.slug, title: row.title }));
}

export function openIndex(indexPath) {
  const db = new DatabaseSync(indexPath);
  migrateIndex(db);
  return db;
}
