import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { listSlugs, readPage } from "./pages.js";

const migrations = [
  (db) => {
    db.exec(`
      CREATE TABLE pages (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE TABLE page_tags (
        slug TEXT NOT NULL REFERENCES pages(slug) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (slug, tag)
      );
      CREATE VIRTUAL TABLE pages_fts USING fts5(
        slug UNINDEXED,
        title,
        body
      );
    `);
  },
];

function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const current = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version").get().version;
  db.exec("BEGIN");
  try {
    for (let version = current + 1; version <= migrations.length; version += 1) {
      migrations[version - 1](db);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function searchTerms(query) {
  // Build the MATCH expression from tokens, rather than passing user input
  // through to FTS5. This makes punctuation (including FTS operators and
  // quotes) ordinary separators and keeps malformed input from becoming an
  // FTS syntax error.
  return [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])];
}

function makeSnippet(body, terms) {
  const escapedTerms = terms.map((term) => term.replace(/[.*+?^${}()|[\[\]\\]/g, "\\$&"));
  const expression = new RegExp(`(${escapedTerms.join("|")})`, "giu");
  const match = expression.exec(body);
  const start = match ? Math.max(0, match.index - 70) : 0;
  const end = Math.min(body.length, start + 180);
  let excerpt = body.slice(start, end).replace(/\s+/g, " ").trim();
  excerpt = excerpt.replace(expression, "**$1**");
  return `${start > 0 ? "…" : ""}${excerpt}${end < body.length ? "…" : ""}`;
}

export function openIndex(indexPath, pagesDir) {
  if (indexPath !== ":memory:") mkdirSync(dirname(indexPath), { recursive: true });
  const db = new DatabaseSync(indexPath);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);

  const upsertPage = db.prepare("INSERT OR REPLACE INTO pages (slug, title, body) VALUES (?, ?, ?)");
  const deleteTags = db.prepare("DELETE FROM page_tags WHERE slug = ?");
  const addTag = db.prepare("INSERT INTO page_tags (slug, tag) VALUES (?, ?)");
  const deleteFts = db.prepare("DELETE FROM pages_fts WHERE slug = ?");
  const addFts = db.prepare("INSERT INTO pages_fts (slug, title, body) VALUES (?, ?, ?)");

  function update(page) {
    upsertPage.run(page.slug, page.title, page.body);
    deleteTags.run(page.slug);
    for (const tag of page.tags) addTag.run(page.slug, tag);
    deleteFts.run(page.slug);
    addFts.run(page.slug, page.title, page.body);
  }

  function remove(slug) {
    db.prepare("DELETE FROM pages WHERE slug = ?").run(slug);
    deleteFts.run(slug);
  }

  function sync() {
    const diskSlugs = listSlugs(pagesDir);
    const diskSet = new Set(diskSlugs);
    db.exec("BEGIN");
    try {
      for (const slug of diskSlugs) update(readPage(pagesDir, slug));
      for (const { slug } of db.prepare("SELECT slug FROM pages").all()) {
        if (!diskSet.has(slug)) remove(slug);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  sync();

  return {
    syncPage: update,
    removePage: remove,
    listPages() {
      return db.prepare("SELECT slug, title FROM pages ORDER BY slug").all().map((page) => ({
        ...page,
        tags: db.prepare("SELECT tag FROM page_tags WHERE slug = ? ORDER BY tag").all(page.slug).map(({ tag }) => tag),
      }));
    },
    getPage(slug) {
      const page = db.prepare("SELECT slug, title, body FROM pages WHERE slug = ?").get(slug);
      if (!page) return undefined;
      const tags = db.prepare("SELECT tag FROM page_tags WHERE slug = ? ORDER BY tag").all(slug).map(({ tag }) => tag);
      return { ...page, tags };
    },
    search(query) {
      const terms = searchTerms(query);
      if (!terms.length) return [];
      const match = terms.map((term) => `"${term}"`).join(" AND ");
      return db.prepare(`
        SELECT p.slug, p.title, p.body, bm25(pages_fts, 10.0, 1.0) AS rank
        FROM pages_fts JOIN pages p ON p.slug = pages_fts.slug
        WHERE pages_fts MATCH ? ORDER BY rank ASC, p.slug ASC LIMIT 20
      `).all(match).map((page) => ({
        slug: page.slug,
        title: page.title,
        snippet: makeSnippet(page.body, terms),
        score: Number((-page.rank).toFixed(6)),
      }));
    },
    listTags() {
      return db.prepare("SELECT tag, COUNT(*) AS count FROM page_tags GROUP BY tag ORDER BY count DESC, tag ASC").all()
        .map(({ tag, count }) => ({ tag, count }));
    },
    pagesForTag(tag) {
      return db.prepare(`
        SELECT p.slug, p.title FROM pages p JOIN page_tags t ON t.slug = p.slug
        WHERE lower(t.tag) = lower(?) ORDER BY p.slug
      `).all(tag);
    },
    close() {
      db.close();
    },
  };
}
