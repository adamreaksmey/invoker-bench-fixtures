import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { listSlugs, pagePath, readPage } from "./pages.js";

export const DEFAULT_INDEX_PATH = process.env.WIKI_INDEX_PATH ?? "wiki-index.sqlite";

const SCHEMA_VERSION_TABLE = "schema_version";
const PAGES_TABLE = "pages";
const PAGE_TAGS_TABLE = "page_tags";
const PAGES_FTS_TABLE = "pages_fts";

const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE ${PAGES_TABLE} (
          slug TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          mtime_ms INTEGER NOT NULL
        );
        CREATE TABLE ${PAGE_TAGS_TABLE} (
          slug TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (slug, tag),
          FOREIGN KEY (slug) REFERENCES ${PAGES_TABLE}(slug) ON DELETE CASCADE
        );
        CREATE VIRTUAL TABLE ${PAGES_FTS_TABLE} USING fts5(
          slug UNINDEXED,
          title,
          body
        );
      `);
    },
  },
];

function ensureSchemaVersionTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (
      version INTEGER PRIMARY KEY NOT NULL
    );
  `);
}

function currentSchemaVersion(db) {
  ensureSchemaVersionTable(db);
  const row = db
    .prepare(`SELECT MAX(version) AS version FROM ${SCHEMA_VERSION_TABLE}`)
    .get();
  return row?.version ?? 0;
}

function recordSchemaVersion(db, version) {
  db.prepare(`INSERT INTO ${SCHEMA_VERSION_TABLE} (version) VALUES (?)`).run(version);
}

export function runMigrations(db) {
  ensureSchemaVersionTable(db);
  let version = currentSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    migration.up(db);
    recordSchemaVersion(db, migration.version);
    version = migration.version;
  }
  return version;
}

function fileMtimeMs(pagesDir, slug) {
  return Math.floor(statSync(pagePath(pagesDir, slug)).mtimeMs);
}

function replaceTags(db, slug, tags) {
  db.prepare(`DELETE FROM ${PAGE_TAGS_TABLE} WHERE slug = ?`).run(slug);
  const insertTag = db.prepare(
    `INSERT INTO ${PAGE_TAGS_TABLE} (slug, tag) VALUES (?, ?)`,
  );
  for (const tag of tags) insertTag.run(slug, tag);
}

function replaceFts(db, slug, title, body) {
  db.prepare(`DELETE FROM ${PAGES_FTS_TABLE} WHERE slug = ?`).run(slug);
  db.prepare(
    `INSERT INTO ${PAGES_FTS_TABLE} (slug, title, body) VALUES (?, ?, ?)`,
  ).run(slug, title, body);
}

export function upsertPageInIndex(db, page, mtimeMs) {
  db.prepare(`
    INSERT INTO ${PAGES_TABLE} (slug, title, body, mtime_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      mtime_ms = excluded.mtime_ms
  `).run(page.slug, page.title, page.body, mtimeMs);
  replaceTags(db, page.slug, page.tags);
  replaceFts(db, page.slug, page.title, page.body);
}

export function removePageFromIndex(db, slug) {
  db.prepare(`DELETE FROM ${PAGES_FTS_TABLE} WHERE slug = ?`).run(slug);
  db.prepare(`DELETE FROM ${PAGE_TAGS_TABLE} WHERE slug = ?`).run(slug);
  db.prepare(`DELETE FROM ${PAGES_TABLE} WHERE slug = ?`).run(slug);
}

export function indexPageFromDisk(db, pagesDir, slug) {
  const page = readPage(pagesDir, slug);
  if (!page) {
    removePageFromIndex(db, slug);
    return false;
  }
  upsertPageInIndex(db, page, fileMtimeMs(pagesDir, slug));
  return true;
}

function indexedMtimes(db) {
  const rows = db.prepare(`SELECT slug, mtime_ms FROM ${PAGES_TABLE}`).all();
  return new Map(rows.map((row) => [row.slug, row.mtime_ms]));
}

export function syncIndexWithPagesDir(db, pagesDir) {
  const diskSlugs = listSlugs(pagesDir);
  const onDisk = new Set(diskSlugs);
  const indexed = indexedMtimes(db);

  for (const slug of diskSlugs) {
    const mtimeMs = fileMtimeMs(pagesDir, slug);
    if (indexed.get(slug) === mtimeMs) continue;
    indexPageFromDisk(db, pagesDir, slug);
  }

  for (const slug of indexed.keys()) {
    if (onDisk.has(slug)) continue;
    removePageFromIndex(db, slug);
  }
}

export function getIndexedPage(db, slug) {
  const page = db
    .prepare(`SELECT slug, title, body, mtime_ms FROM ${PAGES_TABLE} WHERE slug = ?`)
    .get(slug);
  if (!page) return undefined;
  const tags = db
    .prepare(`SELECT tag FROM ${PAGE_TAGS_TABLE} WHERE slug = ? ORDER BY tag`)
    .all(slug)
    .map((row) => row.tag);
  return { slug: page.slug, title: page.title, body: page.body, tags, mtimeMs: page.mtime_ms };
}

export function listIndexedSlugs(db) {
  return db
    .prepare(`SELECT slug FROM ${PAGES_TABLE} ORDER BY slug`)
    .all()
    .map((row) => row.slug);
}

export function getSchemaVersion(db) {
  return currentSchemaVersion(db);
}

const MAX_SEARCH_RESULTS = 20;
const SLUG_BM25_WEIGHT = 0;
const TITLE_BM25_WEIGHT = 10;
const BODY_BM25_WEIGHT = 1;
const SNIPPET_BODY_COLUMN = 2;
const SNIPPET_MARK_START = "**";
const SNIPPET_MARK_END = "**";
const SNIPPET_ELLIPSIS = "...";
const SNIPPET_TOKEN_LIMIT = 32;

export function buildFtsMatchQuery(rawQuery) {
  const terms = String(rawQuery)
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replaceAll('"', '""')}"`);
  if (terms.length === 0) return null;
  return terms.join(" AND ");
}

export function searchPages(db, rawQuery) {
  const matchQuery = buildFtsMatchQuery(rawQuery);
  if (!matchQuery) return [];

  try {
    const rows = db
      .prepare(
        `
        SELECT
          ${PAGES_FTS_TABLE}.slug AS slug,
          ${PAGES_TABLE}.title AS title,
          snippet(
            ${PAGES_FTS_TABLE},
            ${SNIPPET_BODY_COLUMN},
            ?,
            ?,
            ?,
            ${SNIPPET_TOKEN_LIMIT}
          ) AS snippet,
          (
            -bm25(
              ${PAGES_FTS_TABLE},
              ${SLUG_BM25_WEIGHT},
              ${TITLE_BM25_WEIGHT},
              ${BODY_BM25_WEIGHT}
            )
          ) AS score
        FROM ${PAGES_FTS_TABLE}
        JOIN ${PAGES_TABLE}
          ON ${PAGES_TABLE}.slug = ${PAGES_FTS_TABLE}.slug
        WHERE ${PAGES_FTS_TABLE} MATCH ?
        ORDER BY score DESC
        LIMIT ${MAX_SEARCH_RESULTS}
      `,
      )
      .all(SNIPPET_MARK_START, SNIPPET_MARK_END, SNIPPET_ELLIPSIS, matchQuery);

    return rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      snippet: row.snippet,
      score: Number(row.score),
    }));
  } catch {
    return [];
  }
}

export function openWikiIndex(indexPath = DEFAULT_INDEX_PATH) {
  const db = new DatabaseSync(indexPath);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function createWikiIndex(indexPath = DEFAULT_INDEX_PATH) {
  const db = openWikiIndex(indexPath);
  return {
    db,
    sync(pagesDir) {
      syncIndexWithPagesDir(db, pagesDir);
    },
    upsertFromDisk(pagesDir, slug) {
      return indexPageFromDisk(db, pagesDir, slug);
    },
    remove(slug) {
      removePageFromIndex(db, slug);
    },
    getPage(slug) {
      return getIndexedPage(db, slug);
    },
    listSlugs() {
      return listIndexedSlugs(db);
    },
    search(query) {
      return searchPages(db, query);
    },
    schemaVersion() {
      return getSchemaVersion(db);
    },
    close() {
      db.close();
    },
  };
}
