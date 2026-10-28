import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parsePage } from "./frontMatter.js";
import { listSlugs, pagePath } from "./pages.js";

const INITIAL_SCHEMA_VERSION = 1;
const MAX_SEARCH_RESULTS = 20;
const TITLE_MATCH_WEIGHT = 10;
const BODY_MATCH_WEIGHT = 1;

const MIGRATIONS = [
  {
    version: INITIAL_SCHEMA_VERSION,
    statements: [
      `CREATE TABLE IF NOT EXISTS pages (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL
      );`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
        title,
        body,
        content='pages',
        content_rowid='rowid'
      );`,
      `CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;`,
      `CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
      END;`,
      `CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
        INSERT INTO pages_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;`,
      `CREATE TABLE IF NOT EXISTS page_tags (
        slug TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (slug, tag),
        FOREIGN KEY (slug) REFERENCES pages(slug) ON DELETE CASCADE
      );`,
    ],
  },
];

export function openIndex(indexPath, pagesDir) {
  const db = new DatabaseSync(indexPath);
  runMigrations(db);
  const index = createIndex(db);
  index.syncWithDirectory(pagesDir);
  return index;
}

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);
  const currentVersion = readCurrentVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    runMigration(db, migration);
  }
}

function readCurrentVersion(db) {
  const row = db.prepare(`SELECT version FROM schema_version ORDER BY version DESC LIMIT 1`).get();
  return row?.version ?? 0;
}

function runMigration(db, migration) {
  try {
    db.exec("BEGIN");
    for (const statement of migration.statements) {
      db.exec(statement);
    }
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(migration.version);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createIndex(db) {
  const statements = prepareStatements(db);
  return buildIndexApi(db, statements);
}

function prepareStatements(db) {
  return {
    insertPage: db.prepare(`INSERT INTO pages (slug, title, body) VALUES (?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET title = excluded.title, body = excluded.body`),
    clearPages: db.prepare(`DELETE FROM pages`),
    insertTag: db.prepare(`INSERT OR IGNORE INTO page_tags (slug, tag) VALUES (?, ?)`),
    deletePage: db.prepare(`DELETE FROM pages WHERE slug = ?`),
    listPages: db.prepare(`SELECT slug, title FROM pages ORDER BY slug ASC`),
    listTags: db.prepare(`SELECT tag, COUNT(*) AS count FROM page_tags GROUP BY tag ORDER BY count DESC, tag ASC`),
    findPagesByTag: db.prepare(`SELECT p.slug, p.title FROM pages p
      JOIN page_tags pt ON p.slug = pt.slug
      WHERE LOWER(pt.tag) = LOWER(?)
      ORDER BY p.slug ASC`),
    search: db.prepare(`SELECT p.slug, p.title, p.body,
      snippet(pages_fts, 1, '**', '**', '...', 30) AS snippet
      FROM pages p
      JOIN pages_fts ON p.rowid = pages_fts.rowid
      WHERE pages_fts MATCH ?`),
  };
}

function buildIndexApi(db, statements) {
  const { insertPage, clearPages, insertTag, deletePage, listPages, listTags, findPagesByTag, search } = statements;

  return {
    close: () => db.close(),

    syncWithDirectory(pagesDir) {
      runInTransaction(db, () => {
        clearPages.run();
        for (const slug of listSlugs(pagesDir)) {
          const markdown = readFileSync(pagePath(pagesDir, slug), "utf8");
          const page = parsePage(slug, markdown);
          insertPage.run(page.slug, page.title, page.body);
          for (const tag of page.tags) {
            insertTag.run(page.slug, tag);
          }
        }
      });
    },

    indexPage(page) {
      runInTransaction(db, () => {
        deletePage.run(page.slug);
        insertPage.run(page.slug, page.title, page.body);
        for (const tag of page.tags) {
          insertTag.run(page.slug, tag);
        }
      });
    },

    removePage(slug) {
      deletePage.run(slug);
    },

    listPages() {
      const rows = listPages.all();
      const tagsBySlug = loadTagsBySlug(db);
      return rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        tags: tagsBySlug[row.slug] ?? [],
      }));
    },

    listTags() {
      return listTags.all().map((row) => ({ tag: row.tag, count: row.count }));
    },

    findPagesByTag(tag) {
      return findPagesByTag.all(tag).map((row) => ({ slug: row.slug, title: row.title }));
    },

    search(queryText) {
      const terms = extractSearchTerms(queryText);
      if (terms.length === 0) return [];
      const matchExpression = buildMatchExpression(terms);
      const rows = search.all(matchExpression);
      return rankAndLimit(rows, terms, MAX_SEARCH_RESULTS);
    },
  };
}

function loadTagsBySlug(db) {
  const rows = db.prepare(`SELECT slug, tag FROM page_tags ORDER BY slug ASC, tag ASC`).all();
  const result = {};
  for (const row of rows) {
    const tags = result[row.slug] ?? [];
    tags.push(row.tag);
    result[row.slug] = tags;
  }
  return result;
}

function runInTransaction(db, callback) {
  try {
    db.exec("BEGIN");
    callback();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function extractSearchTerms(queryText) {
  return queryText
    .split(/\s+/)
    .map((term) => term.toLowerCase())
    .filter(Boolean);
}

function buildMatchExpression(terms) {
  return terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" ");
}

function rankAndLimit(rows, terms, limit) {
  const results = rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    snippet: row.snippet,
    score: computeScore(row.title, row.body, terms),
  }));
  results.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return results.slice(0, limit);
}

function computeScore(title, body, terms) {
  const titleHits = sumOccurrences(title.toLowerCase(), terms);
  const bodyHits = sumOccurrences(body.toLowerCase(), terms);
  return titleHits * TITLE_MATCH_WEIGHT + bodyHits * BODY_MATCH_WEIGHT;
}

function sumOccurrences(text, terms) {
  let total = 0;
  for (const term of terms) {
    total += countOccurrences(text, term);
  }
  return total;
}

function countOccurrences(text, substring) {
  let count = 0;
  let index = text.indexOf(substring);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(substring, index + substring.length);
  }
  return count;
}
