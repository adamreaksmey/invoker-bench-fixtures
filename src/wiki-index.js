import { DatabaseSync } from "node:sqlite";
import { listSlugs, readPageWithMeta } from "./pages.js";

const SCHEMA_VERSION_TABLE = "schema_version";
const MAX_SEARCH_RESULTS = 20;
const TITLE_BM25_WEIGHT = 10;
const BODY_BM25_WEIGHT = 1;
const SLUG_BM25_WEIGHT = 0;
const SNIPPET_COLUMN_INDEX = 2;
const SNIPPET_MAX_TOKENS = 32;
const SNIPPET_START_MARK = "**";
const SNIPPET_END_MARK = "**";
const SNIPPET_ELLIPSIS = "...";
const TOKEN_PATTERN = /[a-z0-9]+/gi;

const SEARCH_SQL = `
  SELECT
    slug,
    title,
    snippet(
      pages_fts,
      ${SNIPPET_COLUMN_INDEX},
      '${SNIPPET_START_MARK}',
      '${SNIPPET_END_MARK}',
      '${SNIPPET_ELLIPSIS}',
      ${SNIPPET_MAX_TOKENS}
    ) AS snippet,
    -bm25(
      pages_fts,
      ${SLUG_BM25_WEIGHT},
      ${TITLE_BM25_WEIGHT},
      ${BODY_BM25_WEIGHT}
    ) AS score
  FROM pages_fts
  WHERE pages_fts MATCH ?
  ORDER BY bm25(
    pages_fts,
    ${SLUG_BM25_WEIGHT},
    ${TITLE_BM25_WEIGHT},
    ${BODY_BM25_WEIGHT}
  )
  LIMIT ?
`;

const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE pages (
          slug TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          mtime_ms INTEGER NOT NULL
        );
        CREATE TABLE page_tags (
          slug TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (slug, tag),
          FOREIGN KEY (slug) REFERENCES pages(slug) ON DELETE CASCADE
        );
        CREATE INDEX page_tags_tag_idx ON page_tags(tag);
        CREATE VIRTUAL TABLE pages_fts USING fts5(
          slug UNINDEXED,
          title,
          body
        );
      `);
    },
  },
];

function ensureSchemaVersionRow(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (version INTEGER NOT NULL)`,
  );
  const row = db.prepare(`SELECT version FROM ${SCHEMA_VERSION_TABLE} LIMIT 1`).get();
  if (row) return row.version;
  db.prepare(`INSERT INTO ${SCHEMA_VERSION_TABLE} (version) VALUES (0)`).run();
  return 0;
}

function migrate(db) {
  let currentVersion = ensureSchemaVersionRow(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare(`UPDATE ${SCHEMA_VERSION_TABLE} SET version = ?`).run(migration.version);
      db.exec("COMMIT");
      currentVersion = migration.version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function removePageRows(db, slug) {
  db.prepare("DELETE FROM pages_fts WHERE slug = ?").run(slug);
  db.prepare("DELETE FROM page_tags WHERE slug = ?").run(slug);
  db.prepare("DELETE FROM pages WHERE slug = ?").run(slug);
}

function insertPageRows(db, page, mtimeMs) {
  db.prepare(
    "INSERT INTO pages (slug, title, body, mtime_ms) VALUES (?, ?, ?, ?)",
  ).run(page.slug, page.title, page.body, mtimeMs);
  const insertTag = db.prepare(
    "INSERT INTO page_tags (slug, tag) VALUES (?, ?)",
  );
  for (const tag of page.tags) insertTag.run(page.slug, tag);
  db.prepare(
    "INSERT INTO pages_fts (slug, title, body) VALUES (?, ?, ?)",
  ).run(page.slug, page.title, page.body);
}

function upsertPage(db, page, mtimeMs) {
  db.exec("BEGIN");
  try {
    removePageRows(db, page.slug);
    insertPageRows(db, page, mtimeMs);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function buildFtsQuery(rawQuery) {
  const tokens = rawQuery.match(TOKEN_PATTERN);
  if (!tokens || tokens.length === 0) return undefined;
  return tokens.map((token) => `"${token.toLowerCase()}"`).join(" AND ");
}

function syncDirectory(db, pagesDir) {
  const diskSlugs = listSlugs(pagesDir);
  const indexed = db.prepare("SELECT slug, mtime_ms FROM pages").all();
  const indexedBySlug = new Map(indexed.map((row) => [row.slug, row.mtime_ms]));
  const diskSlugSet = new Set(diskSlugs);

  for (const slug of indexedBySlug.keys()) {
    if (!diskSlugSet.has(slug)) removePageRows(db, slug);
  }

  for (const slug of diskSlugs) {
    const page = readPageWithMeta(pagesDir, slug);
    if (!page) continue;
    if (indexedBySlug.get(slug) === page.mtimeMs) continue;
    upsertPage(db, page, page.mtimeMs);
  }
}

function searchPages(db, rawQuery) {
  const ftsQuery = buildFtsQuery(rawQuery);
  if (!ftsQuery) return [];
  return db
    .prepare(SEARCH_SQL)
    .all(ftsQuery, MAX_SEARCH_RESULTS)
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      snippet: row.snippet,
      score: row.score,
    }));
}

function listTagCounts(db) {
  return db
    .prepare(
      `SELECT tag, COUNT(*) AS count
       FROM page_tags
       GROUP BY tag
       ORDER BY count DESC, tag ASC`,
    )
    .all()
    .map((row) => ({ tag: row.tag, count: row.count }));
}

function listPagesForTag(db, tag) {
  const normalizedTag = tag.trim().toLowerCase();
  return db
    .prepare(
      `SELECT pages.slug AS slug, pages.title AS title
       FROM page_tags
       JOIN pages ON pages.slug = page_tags.slug
       WHERE page_tags.tag = ?
       ORDER BY pages.slug ASC`,
    )
    .all(normalizedTag)
    .map((row) => ({ slug: row.slug, title: row.title }));
}

function removeIndexedPage(db, slug) {
  db.exec("BEGIN");
  try {
    removePageRows(db, slug);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openWikiIndex(indexPath) {
  const db = new DatabaseSync(indexPath);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);

  return {
    syncFromDirectory: (pagesDir) => syncDirectory(db, pagesDir),
    indexPage: (page, mtimeMs) => upsertPage(db, page, mtimeMs),
    removePage: (slug) => removeIndexedPage(db, slug),
    search: (rawQuery) => searchPages(db, rawQuery),
    listTags: () => listTagCounts(db),
    pagesForTag: (tag) => listPagesForTag(db, tag),
    close: () => db.close(),
  };
}
